import test from 'node:test';
import assert from 'node:assert/strict';

import { planDateEdit } from '../src/dateEdits/dateEditPlan.js';

/** The real correction for a Pixel file: two hours back. */
const MODIFICATION = {
  fileName: 'pxl_20260816_123028409.jpg',
  original: { year: 2026, month: 8, day: 16, hour: 14, minute: 30, second: 28 },
  corrected: { year: 2026, month: 8, day: 16, hour: 12, minute: 30, second: 28 },
};

/** What the five boxes show for that photo before anything is changed. */
const SHOWING_ORIGINAL = { year: '2026', month: '08', day: '16', hour: '14', minute: '30' };

/** The chooser as Google Photos leaves it: the camera's home offset, not Ghana's. */
const HOME_ZONE = { text: 'gmt+02:00 central european summer time', offsetMinutes: 120 };
const GHANA_ZONE = { text: 'gmt+00:00 greenwich mean time', offsetMinutes: 0 };

/**
 * @param {Partial<typeof SHOWING_ORIGINAL>} [changes]
 * @param {import('../src/dateEdits/dateEditPlan.js').DialogTimeZone | null} [timeZone]
 */
function plan(changes = {}, timeZone = HOME_ZONE) {
  return planDateEdit({ reading: { ...SHOWING_ORIGINAL, ...changes }, timeZone, modification: MODIFICATION });
}

test('writes the corrected numbers and moves the chooser to GMT+00:00', () => {
  const result = plan();
  assert.equal(result.verdict, 'write');
  assert.deepEqual(result.values, { year: '2026', month: '08', day: '16', hour: '12', minute: '30' });
  assert.equal(result.timeZoneOffsetMinutes, 0);
});

test('the right numbers under the wrong offset are still work to do', () => {
  // This is exactly what an earlier version of this extension left behind: it
  // wrote 12:30 and left GMT+02:00, which is 10:30 in real terms. The numbers go
  // back unchanged and the offset is put right.
  const result = plan({ hour: '12' });
  assert.equal(result.verdict, 'write');
  assert.deepEqual(result.values, { year: '2026', month: '08', day: '16', hour: '12', minute: '30' });
  assert.equal(result.timeZoneOffsetMinutes, 0);
});

test('a photo is finished only when the numbers and the offset are both right', () => {
  assert.equal(plan({ hour: '12' }, GHANA_ZONE).verdict, 'already-correct');
});

test('refuses when the dialog does not show the timestamp the list expects', () => {
  // The guard that catches a dialog belonging to another photo, and a photo
  // somebody already corrected by hand.
  assert.equal(plan({ minute: '31' }).verdict, 'unexpected-current');
  assert.equal(plan({ day: '17' }).verdict, 'unexpected-current');
  assert.equal(plan({ year: '2019' }).verdict, 'unexpected-current');
});

test('refuses when a box holds something that is not a number', () => {
  const result = plan({ hour: '' });
  assert.equal(result.verdict, 'unexpected-current');
  assert.equal(result.values, null);
});

test('a dialog with no chooser is handled on the numbers alone', () => {
  // Nothing is read and nothing is written there, so a photo showing the
  // corrected time counts as finished.
  assert.equal(plan({ hour: '12' }, null).verdict, 'already-correct');
  const result = plan({}, null);
  assert.equal(result.verdict, 'write');
  assert.equal(result.timeZoneOffsetMinutes, null);
});

test('a chooser whose label names no offset is left alone', () => {
  // Moving a chooser we cannot read would move the photo by an unknown amount.
  const unreadable = { text: 'europe/madrid', offsetMinutes: null };
  assert.equal(plan({ hour: '12' }, unreadable).verdict, 'already-correct');
  assert.equal(plan({}, unreadable).timeZoneOffsetMinutes, null);
});

test('says how far the dialog is from what was expected', () => {
  // A whole album off by the same amount is how a timezone difference looks.
  assert.equal(plan({ hour: '16' }).minutesOff, 120);
  assert.equal(plan({ day: '17' }).minutesOff, 24 * 60);
});

test('a refusal never carries values to type', () => {
  const result = plan({ minute: '31' });
  assert.equal(result.values, null);
  assert.equal(result.timeZoneOffsetMinutes, null);
});

test('reports the reading with its offset, so a refusal can be checked by eye', () => {
  assert.equal(plan().shown, '2026:08:16 14:30:00 GMT+02:00');
  assert.equal(plan({}, { text: 'gmt-03:30 newfoundland', offsetMinutes: -210 }).shown, '2026:08:16 14:30:00 GMT-03:30');
  assert.equal(plan({}, null).shown, '2026:08:16 14:30:00');
});
