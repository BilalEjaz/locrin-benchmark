/**
 * Turns "this is what the dialog shows" plus "this is the correction we want"
 * into "type exactly this", or into a refusal.
 *
 * ## Why a refusal is the normal outcome, not an error
 *
 * Setting the wrong date on a photo is close to invisible. The photo moves in
 * the timeline, the original reading is gone, and nothing on screen says a
 * mistake happened. Undoing it means knowing what the value used to be, which is
 * exactly the thing that was lost.
 *
 * So the run only types when the dialog **already shows the timestamp the list
 * says this photo has**. That one check catches a dialog belonging to the photo
 * the viewer just left, a file name matched to the wrong photo, and a photo
 * somebody already corrected by hand. Anything else is reported and skipped, and
 * a skipped photo costs the user one manual edit that the report names.
 *
 * The comparison stops at the minute, because the dialog has no seconds box.
 *
 * ## The timezone counts as part of the answer
 *
 * A photo is only finished when the numbers **and** the offset are right. See
 * `dateDialogTimeZone.js`: the five numbers are a local reading, so the same
 * numbers under a different offset are a different moment. A photo already
 * showing the corrected time under the wrong offset is therefore still work to
 * do, not a photo to skip.
 */

import { equalsToTheMinute, formatExifDateTime } from './dateTimeParts.js';
import { parseDialogParts, renderDialogParts } from './dateDialogFields.js';

/**
 * Where the corrected timestamps are to be read, in minutes east of Greenwich.
 *
 * Zero, because the corrections in `modifications.json` are Ghana local time and
 * Ghana is UTC+0 all year. Change this one number for a trip somewhere else.
 */
export const TARGET_TIME_ZONE_OFFSET_MINUTES = 0;

/**
 * @typedef {import('./dateTimeParts.js').DateTimeParts} DateTimeParts
 * @typedef {import('./modificationsList.js').DateModification} DateModification
 * @typedef {import('./dateDialogFields.js').DialogPartValues} DialogPartValues
 *
 * @typedef {object} DialogTimeZone
 * @property {string} text                  What the chooser shows now.
 * @property {number | null} offsetMinutes  Its offset, or null when the label names none.
 *
 * @typedef {'write' | 'already-correct' | 'unexpected-current'} DateEditVerdict
 *
 * @typedef {object} DateEditPlan
 * @property {DateEditVerdict} verdict
 * @property {DialogPartValues | null} values        What to type, when the verdict is `write`.
 * @property {number | null} timeZoneOffsetMinutes   What to set the chooser to, or null to leave it.
 * @property {string | null} shown                   What the dialog reads as, for the report.
 * @property {number | null} minutesOff              How far the dialog is from what the list expected.
 */

/**
 * How far apart two readings are, in whole minutes.
 *
 * This is only for the report, and it is the fastest way to recognise a whole
 * album refused for one reason: every photo off by the same number of minutes
 * means Google Photos is showing the times in another timezone.
 * @param {DateTimeParts} shown
 * @param {DateTimeParts} expected
 * @returns {number}
 */
function minutesBetween(shown, expected) {
  const asMinutes = (/** @type {DateTimeParts} */ parts) =>
    Math.round(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) / 60000);
  return asMinutes(shown) - asMinutes(expected);
}

/**
 * @param {object} input
 * @param {DialogPartValues} input.reading         What the five boxes hold right now.
 * @param {DialogTimeZone | null} input.timeZone   What the chooser holds, or null when the dialog has none.
 * @param {DateModification} input.modification    The correction for this file.
 * @returns {DateEditPlan}
 */
export function planDateEdit({ reading, timeZone, modification }) {
  const current = parseDialogParts(reading);
  if (current === null) {
    return {
      verdict: 'unexpected-current',
      values: null,
      timeZoneOffsetMinutes: null,
      shown: describeBoxes(reading),
      minutesOff: null,
    };
  }

  const shown = describeReading(current, timeZone);

  // A dialog with no chooser, or one whose label names no offset, leaves the
  // timezone out of the question entirely: it is not read and not written.
  const target = timeZone === null || timeZone.offsetMinutes === null ? null : TARGET_TIME_ZONE_OFFSET_MINUTES;
  const timeZoneIsRight = target === null || timeZone?.offsetMinutes === target;

  /**
   * @param {DateEditVerdict} verdict
   * @param {number | null} minutesOff
   * @returns {DateEditPlan}
   */
  const refuse = (verdict, minutesOff) => ({ verdict, values: null, timeZoneOffsetMinutes: null, shown, minutesOff });

  // Already done? Checked first, so a second run over the same album reports
  // every photo as finished instead of refusing them all.
  const timeIsCorrected = equalsToTheMinute(current, modification.corrected);
  if (timeIsCorrected && timeZoneIsRight) return refuse('already-correct', 0);

  // The numbers are right and the offset is not, which is what a photo corrected
  // by an earlier version of this extension looks like. The numbers are written
  // again unchanged, and the offset is put right.
  if (!timeIsCorrected && !equalsToTheMinute(current, modification.original)) {
    return refuse('unexpected-current', minutesBetween(current, modification.original));
  }

  return {
    verdict: 'write',
    values: renderDialogParts(modification.corrected, reading),
    timeZoneOffsetMinutes: target,
    shown,
    minutesOff: 0,
  };
}

/**
 * @param {DateTimeParts} parts
 * @param {DialogTimeZone | null} timeZone
 * @returns {string}
 */
function describeReading(parts, timeZone) {
  const stamp = formatExifDateTime(parts);
  if (timeZone === null) return stamp;

  const offset = timeZone.offsetMinutes;
  if (offset === null) return `${stamp} (${timeZone.text})`;

  const sign = offset < 0 ? '-' : '+';
  const size = Math.abs(offset);
  return `${stamp} GMT${sign}${String(Math.floor(size / 60)).padStart(2, '0')}:${String(size % 60).padStart(2, '0')}`;
}

/**
 * What the boxes hold, when they do not read as a timestamp at all.
 * @param {DialogPartValues} reading
 * @returns {string}
 */
function describeBoxes(reading) {
  return `year=${reading.year} month=${reading.month} day=${reading.day} hour=${reading.hour} minute=${reading.minute}`;
}
