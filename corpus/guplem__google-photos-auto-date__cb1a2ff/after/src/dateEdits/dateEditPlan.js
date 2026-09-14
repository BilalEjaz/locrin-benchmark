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
 * So the reading is checked before anything is typed. What it can be checked
 * against is the point below.
 *
 * ## What the dialog shows is not `original_datetime`
 *
 * The five numbers are the photo's time **in the zone the chooser names**, and
 * Google Photos picks that zone per photo, from the file or from where it was
 * taken. The same photo therefore reads differently depending on which zone it
 * was given, and only a photo whose zone happens to match its camera's own
 * offset reads exactly as `original_datetime`.
 *
 * An earlier version demanded that exact match and refused everything else. In
 * one real run that refused 130 photos of 440: every Panasonic shot sat at
 * `GMT+01:00` and read one hour past its `original_datetime`, every video and
 * every photo Google had placed at `GMT+00:00` read two hours past it, and the
 * ones that passed were simply the ones Google had left at `GMT+02:00`. Each
 * reading obeyed `shown + offset = original + 2h`: the same moment, written down
 * in a different place. Nothing was wrong with those photos.
 *
 * ## So the reading is a sanity check, not an equality
 *
 * What gets typed does not depend on the reading at all. It is always
 * `corrected_datetime` at `TARGET_TIME_ZONE_OFFSET_MINUTES`, whatever the dialog
 * held before, which makes a run idempotent and a second run over the same album
 * harmless.
 *
 * That leaves the reading with one job: proving the dialog belongs to the photo
 * we mean. A dialog left over from the photo the viewer just left, or opened on
 * a file name matched to the wrong photo, shows some other day. So the reading
 * has to land within `MAX_PLAUSIBLE_SHIFT_MINUTES` of the corrected value, and
 * no timezone on earth can move a reading further than that.
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

import { formatExifDateTime } from './dateTimeParts.js';
import { parseDialogParts, renderDialogParts } from './dateDialogFields.js';

/**
 * Where the corrected timestamps are to be read, in minutes east of Greenwich.
 *
 * Zero, because the corrections in `modifications.json` are Ghana local time and
 * Ghana is UTC+0 all year. Change this one number for a trip somewhere else.
 */
export const TARGET_TIME_ZONE_OFFSET_MINUTES = 0;

/**
 * How far the dialog may read from the corrected value and still be believed.
 *
 * One day. A timezone can account for at most fourteen hours, and a correction
 * in the list for a few more, so a whole day is wide enough for any photo that
 * really is the one we mean. A dialog belonging to a different photo is caught
 * because an album spans days: the neighbouring photo is minutes away, which
 * this does not catch, and the three file-name guards in
 * `albumDateEditingRun.js` are what stand in the way of that one.
 */
export const MAX_PLAUSIBLE_SHIFT_MINUTES = 24 * 60;

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
 * @property {number | null} minutesOff              How far the dialog is from the corrected value.
 */

/**
 * How far apart two readings are, in whole minutes.
 *
 * This is only for the report, and it is the fastest way to recognise a whole
 * album reading the same way for one reason: every photo off by the same number
 * of minutes means Google Photos is showing the times in another timezone.
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

  // How far the dialog sits from where this photo is meant to end up. Reported
  // for every verdict, because a column of identical numbers is how a timezone
  // difference looks and a wild one is how a wrong photo looks.
  const minutesOff = minutesBetween(current, modification.corrected);

  // Already done? Checked first, so a second run over the same album reports
  // every photo as finished instead of editing them all again. The offset counts:
  // the right numbers under the wrong offset are a different moment, and that is
  // exactly what an earlier version of this extension left behind.
  if (minutesOff === 0 && timeZoneIsRight) return refuse('already-correct', 0);

  // Too far away to be this photo at all. See the note at the top: a reading that
  // is merely hours out is a zone Google chose, not a mistake, and gets written.
  if (Math.abs(minutesOff) > MAX_PLAUSIBLE_SHIFT_MINUTES) {
    return refuse('unexpected-current', minutesOff);
  }

  return {
    verdict: 'write',
    values: renderDialogParts(modification.corrected, reading),
    timeZoneOffsetMinutes: target,
    shown,
    minutesOff,
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
