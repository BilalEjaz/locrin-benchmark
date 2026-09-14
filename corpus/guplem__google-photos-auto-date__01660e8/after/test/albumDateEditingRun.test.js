import test from 'node:test';
import assert from 'node:assert/strict';

import { runAlbumDateEditing } from '../src/dateEdits/albumDateEditingRun.js';
import { planDateEdit } from '../src/dateEdits/dateEditPlan.js';
import { formatExifDateTime, parseExifDateTime } from '../src/dateEdits/dateTimeParts.js';
import { createModificationsLookup } from '../src/dateEdits/modificationsList.js';

/** Where each part sits in the fake dialog. The real one lists them in this order. */
const PARTS = { year: 0, month: 1, day: 2, hour: 3, minute: 4 };

/**
 * The offset Google Photos leaves on these files: the camera's home timezone,
 * not Ghana's.
 * @type {import('../src/dateEdits/dateEditPlan.js').DialogTimeZone}
 */
const HOME_ZONE = { text: 'gmt+02:00 central european summer time', offsetMinutes: 120 };

/**
 * What the five boxes would show for a timestamp.
 * @param {string} exifDateTime
 * @returns {import('../src/dateEdits/dateDialogFields.js').DialogPartValues}
 */
function boxes(exifDateTime) {
  const parts = /** @type {NonNullable<ReturnType<typeof parseExifDateTime>>} */ (parseExifDateTime(exifDateTime));
  const pad = (/** @type {number} */ value, /** @type {number} */ width) => String(value).padStart(width, '0');
  return {
    year: pad(parts.year, 4),
    month: pad(parts.month, 2),
    day: pad(parts.day, 2),
    hour: pad(parts.hour, 2),
    minute: pad(parts.minute, 2),
  };
}

/**
 * @param {string} fileName
 * @param {string} original
 * @param {string} corrected
 */
function correction(fileName, original, corrected) {
  return {
    fileName,
    original: /** @type {any} */ (parseExifDateTime(original)),
    corrected: /** @type {any} */ (parseExifDateTime(corrected)),
  };
}

/**
 * An album the walk can step through, with no browser and no real time.
 *
 * Two things make it worth having. The clock only moves when the code under test
 * calls `wait`, so a run of a hundred photos finishes at once; and `staleMs`
 * reproduces the one behaviour that breaks a naive walk, where the info panel
 * keeps describing the photo the viewer just left.
 *
 * @param {{ key: string, fileName: string, shows: string }[]} photos
 * @param {object} [options]
 * @param {number} [options.staleMs]         How long the panel keeps showing the previous photo.
 * @param {boolean} [options.dialogOpens]    False to model a photo whose dialog never appears.
 * @param {boolean} [options.saveWorks]      False to model a Save that does nothing.
 * @param {boolean} [options.boxesRefuse]    True to model boxes that put the old value back.
 * @param {boolean} [options.chooserRefuses] True to model a timezone chooser that will not move.
 * @param {number} [options.chooserRefusesTimes] How many times the chooser refuses before it works. The real flake.
 * @param {boolean} [options.noTimeZone]     True to model a dialog whose chooser cannot be found at all.
 * @param {'enabled' | 'disabled' | 'missing'} [options.nextControlAtEnd]
 * @param {boolean} [options.viewerClosesAtEnd]
 */
function createFakeAlbum(photos, options = {}) {
  const staleMs = options.staleMs ?? 0;
  const dialogOpens = options.dialogOpens ?? true;
  const saveWorks = options.saveWorks ?? true;
  const boxesRefuse = options.boxesRefuse ?? false;
  const chooserRefuses = options.chooserRefuses ?? false;
  let chooserRefusesLeft = options.chooserRefusesTimes ?? 0;
  const noTimeZone = options.noTimeZone ?? false;

  const state = photos.map((photo) => ({ ...photo, values: boxes(photo.shows), zone: { ...HOME_ZONE } }));

  let index = 0;
  let now = 0;
  let arrivedAt = 0;
  let viewerOpen = true;
  let dialogOpen = false;
  /** @type {import('../src/dateEdits/dateDialogFields.js').DialogPartValues | null} */
  let typed = null;
  /** @type {import('../src/dateEdits/dateEditPlan.js').DialogTimeZone | null} */
  let typedZone = null;

  /** @type {{ fileName: string, values: Record<string, string>, zone: { text: string, offsetMinutes: number | null } }[]} */
  const saved = [];
  /** @type {number[]} */
  const infoPanelAttempts = [];

  const current = () => /** @type {(typeof state)[number]} */ (state[index]);
  const atEnd = () => index >= state.length - 1;
  // For `staleMs` after a move, everything on screen still belongs to the photo
  // the viewer just left. This is the point of the fake.
  const stale = () => now - arrivedAt < staleMs;

  const deps = {
    readCurrentPhotoKey: () => (viewerOpen && state.length > 0 ? current().key : null),

    readFileName: () => {
      if (!viewerOpen) return null;
      const photo = stale() ? state[index - 1] : current();
      // An empty name is the page showing nothing readable, which is null, not
      // a photo whose name happens to be empty.
      return photo?.fileName === undefined || photo.fileName === '' ? null : photo.fileName;
    },

    isAnyDialogOpen: () => dialogOpen,
    isEditDialogOpen: () => dialogOpen,

    openEditDialog: () => {
      if (!dialogOpens) return false;
      dialogOpen = true;
      typed = null;
      typedZone = null;
      return true;
    },

    readEditDialog: () => {
      if (!dialogOpen) return null;
      const timeZone = noTimeZone ? null : (typedZone ?? { ...current().zone });
      return { reading: typed ?? { ...current().values }, parts: PARTS, timeZone };
    },

    /**
     * @param {import('../src/dateEdits/dateDialogFields.js').DialogPartValues} values
     */
    writeEditDialog: (values) => {
      if (!dialogOpen) return false;
      // Google Photos puts the old value back when it will not take the new one.
      if (boxesRefuse) return false;
      typed = { ...values };
      return true;
    },

    /**
     * @param {number} offsetMinutes
     * @returns {Promise<boolean>}
     */
    setEditDialogTimeZone: async (offsetMinutes) => {
      if (!dialogOpen || chooserRefuses) return false;
      if (chooserRefusesLeft > 0) {
        chooserRefusesLeft -= 1;
        return false;
      }
      typedZone = { text: 'gmt+00:00 greenwich mean time', offsetMinutes };
      return true;
    },

    saveEditDialog: () => {
      if (!dialogOpen || typed === null) return false;
      if (!saveWorks) return true; // The button is there and does nothing.
      const photo = current();
      photo.values = { ...typed };
      if (typedZone !== null) photo.zone = { ...typedZone };
      saved.push({ fileName: photo.fileName, values: { ...typed }, zone: { ...photo.zone } });
      dialogOpen = false;
      return true;
    },

    closeEditDialog: () => {
      dialogOpen = false;
      typed = null;
      typedZone = null;
    },

    /** @param {number} attempt */
    requestInfoPanel: (attempt) => infoPanelAttempts.push(attempt),

    readNextControlState: () => (atEnd() ? (options.nextControlAtEnd ?? 'disabled') : 'enabled'),

    requestNextPhoto: async () => {
      if (atEnd()) {
        if (options.viewerClosesAtEnd === true) viewerOpen = false;
        return;
      }
      index += 1;
      arrivedAt = now;
    },

    keepPageAwake: () => {},

    /** @param {number} milliseconds */
    wait: async (milliseconds) => {
      now += milliseconds;
    },

    now: () => now,
  };

  return {
    deps,

    /** Puts the viewer back on the first photo, the way pressing Start again does. */
    rewind() {
      index = 0;
      arrivedAt = now;
      viewerOpen = true;
      dialogOpen = false;
      typed = null;
      typedZone = null;
    },

    get saved() {
      return saved;
    },
    get infoPanelAttempts() {
      return infoPanelAttempts;
    },
    get dialogOpen() {
      return dialogOpen;
    },
    get photos() {
      return state;
    },
  };
}

/**
 * @param {ReturnType<typeof createFakeAlbum>} album
 * @param {readonly ReturnType<typeof correction>[]} corrections
 * @param {object} [overrides]
 */
async function run(album, corrections, overrides = {}) {
  const lookup = createModificationsLookup(corrections);
  /** @type {import('../src/dateEdits/albumDateEditingRun.js').PhotoResult[]} */
  const results = [];

  const outcome = await runAlbumDateEditing({
    ...album.deps,
    findModification: (fileName) => lookup.find(fileName),
    planEdit: (reading, timeZone, modification) => planDateEdit({ reading, timeZone, modification }),
    onResult: (result) => results.push(result),
    onProgress: () => {},
    shouldStop: () => false,
    pollMs: 10,
    minDwellMs: 20,
    confirmMs: 20,
    timeoutMs: 3000,
    saveConfirmMs: 500,
    dryRun: false,
    ...overrides,
  });

  return { outcome, results };
}

const THREE_PHOTOS = [
  { key: 'p1', fileName: '01001519.jpg', shows: '2026:08:16 14:20:32' },
  { key: 'p2', fileName: '01001524.jpg', shows: '2026:08:16 14:23:11' },
  { key: 'p3', fileName: 'holiday.jpg', shows: '2026:08:16 14:30:00' },
];

const TWO_CORRECTIONS = [
  correction('01001519.jpg', '2026:08:16 14:20:32', '2026:08:16 13:20:32'),
  correction('01001524.jpg', '2026:08:16 14:23:11', '2026:08:16 13:23:11'),
];

test('corrects only the photos the list names', async () => {
  const album = createFakeAlbum(THREE_PHOTOS);
  const { outcome, results } = await run(album, TWO_CORRECTIONS);

  assert.equal(outcome.reason, 'end-of-album');
  assert.equal(outcome.visited, 3);
  assert.equal(outcome.edited, 2);
  assert.equal(outcome.notInList, 1);
  assert.deepEqual(
    album.saved.map((entry) => entry.fileName),
    ['01001519.jpg', '01001524.jpg'],
  );
  assert.deepEqual(
    results.map((result) => result.action),
    ['edited', 'edited', 'not-in-list'],
  );
});

test('writes the corrected time, not some other time', async () => {
  const album = createFakeAlbum(THREE_PHOTOS);
  await run(album, TWO_CORRECTIONS);

  assert.deepEqual(album.saved[0], {
    fileName: '01001519.jpg',
    values: boxes('2026:08:16 13:20:32'),
    zone: { text: 'gmt+00:00 greenwich mean time', offsetMinutes: 0 },
  });
});

test('changes only the boxes that need changing', async () => {
  // The correction moves the hour and nothing else, so the other four boxes must
  // come back holding exactly what they held.
  const album = createFakeAlbum(THREE_PHOTOS);
  await run(album, TWO_CORRECTIONS);

  const written = /** @type {Record<string, string>} */ (album.saved[0]?.values);
  assert.equal(written.year, '2026');
  assert.equal(written.month, '08');
  assert.equal(written.day, '16');
  assert.equal(written.minute, '20');
  assert.equal(written.hour, '13');
});

test('sets the timezone as well as the numbers', async () => {
  // The five numbers are a local reading. Writing 12:30 under GMT+02:00 would
  // make the photo 10:30 in real terms, two hours before it was taken.
  const album = createFakeAlbum(THREE_PHOTOS);
  await run(album, TWO_CORRECTIONS);

  assert.equal(album.saved[0]?.zone.offsetMinutes, 0);
  assert.equal(album.photos[0]?.zone.offsetMinutes, 0);
});

test('the right numbers under the wrong offset are corrected, not skipped', async () => {
  // What an earlier version of this extension left behind: the time already
  // reads as corrected, and the offset still belongs to the camera's home.
  const album = createFakeAlbum([{ key: 'p1', fileName: '01001519.jpg', shows: '2026:08:16 13:20:32' }]);
  const { outcome } = await run(album, TWO_CORRECTIONS);

  assert.equal(outcome.edited, 1);
  assert.equal(outcome.alreadyCorrect, 0);
  assert.equal(album.saved[0]?.zone.offsetMinutes, 0);
});

test('a photo is finished only once its offset is right too', async () => {
  const album = createFakeAlbum(THREE_PHOTOS);
  await run(album, TWO_CORRECTIONS);

  album.rewind();
  const second = await run(album, TWO_CORRECTIONS);
  assert.equal(second.outcome.edited, 0);
  assert.equal(second.outcome.alreadyCorrect, 2);
});

test('a chooser that will not move stops the run before it presses Save', async () => {
  // Saving the numbers without the offset is the half-applied edit this whole
  // design exists to avoid.
  const album = createFakeAlbum(THREE_PHOTOS, { chooserRefuses: true });
  const { outcome } = await run(album, TWO_CORRECTIONS);

  assert.equal(outcome.saveFailed, 2);
  assert.equal(outcome.edited, 0);
  assert.deepEqual(album.saved, []);
});

test('a chooser that refuses once is tried again, and the photo is edited', async () => {
  // The real flake: one photo of 231 failed at the timezone step while its
  // neighbours, taken seconds earlier, went through. Nothing is written when
  // that step fails, so the attempt costs nothing and the next one succeeds.
  const album = createFakeAlbum(THREE_PHOTOS, { chooserRefusesTimes: 1 });
  const { outcome, results } = await run(album, TWO_CORRECTIONS);

  assert.equal(outcome.edited, 2);
  assert.equal(outcome.saveFailed, 0);
  assert.equal(results.find((result) => result.action === 'edited')?.attempts, 2);
});

test('a photo that fails every attempt is reported once, not three times', async () => {
  const album = createFakeAlbum(THREE_PHOTOS, { chooserRefuses: true });
  const { outcome, results } = await run(album, TWO_CORRECTIONS);

  assert.equal(outcome.saveFailed, 2);
  assert.equal(results.filter((result) => result.action === 'save-failed').length, 2);
  assert.equal(results.find((result) => result.action === 'save-failed')?.attempts, 3);
});

test('a verdict about the photo is never retried', async () => {
  // Nothing on the page would change the answer, so a second attempt would only
  // open the same dialog again and read the same numbers.
  const album = createFakeAlbum([{ key: 'p1', fileName: '01001519.jpg', shows: '2019:01:03 09:00:00' }]);
  const { outcome, results } = await run(album, TWO_CORRECTIONS);

  assert.equal(outcome.unexpectedCurrent, 1);
  assert.equal(results[0]?.attempts, 1);
});

test('a dialog with no readable timezone is counted, never called finished in silence', async () => {
  // The numbers still get put right, but a photo whose offset was never checked
  // is not a photo known to be done, and the report has to say so.
  const album = createFakeAlbum(THREE_PHOTOS, { noTimeZone: true });
  const { outcome } = await run(album, TWO_CORRECTIONS);

  assert.equal(outcome.timeZoneUnreadable, 2);
  assert.equal(outcome.edited, 2);
});

test('a stale info panel never rewrites the photo the viewer just left', async () => {
  // Without the guards the walk would read the previous photo's name on arrival,
  // open the dialog on the photo actually on screen, and write one photo's
  // correction onto its neighbour.
  const album = createFakeAlbum(THREE_PHOTOS, { staleMs: 300 });
  const { outcome } = await run(album, TWO_CORRECTIONS);

  assert.equal(outcome.edited, 2);
  assert.deepEqual(
    album.saved.map((entry) => entry.fileName),
    ['01001519.jpg', '01001524.jpg'],
  );
});

test('a dry run reports what it would do and changes nothing', async () => {
  const album = createFakeAlbum(THREE_PHOTOS);
  const { outcome } = await run(album, TWO_CORRECTIONS, { dryRun: true });

  assert.equal(outcome.wouldEdit, 2);
  assert.equal(outcome.edited, 0);
  assert.deepEqual(album.saved, []);
});

test('a photo that does not hold the expected timestamp is refused, not forced', async () => {
  // Somebody corrected this one by hand already, or it is a different copy of
  // the file. Either way there is no reason to believe the correction applies.
  const album = createFakeAlbum([{ key: 'p1', fileName: '01001519.jpg', shows: '2019:01:03 09:00:00' }]);
  const { outcome, results } = await run(album, TWO_CORRECTIONS);

  assert.equal(outcome.unexpectedCurrent, 1);
  assert.equal(outcome.edited, 0);
  assert.deepEqual(album.saved, []);
  assert.equal(results[0]?.action, 'unexpected-current');
  assert.equal(results[0]?.shown, '2019:01:03 09:00:00 GMT+02:00');
});

test('a photo Google Photos moved to another timezone is edited, and the report says how far it was', async () => {
  // 01001519.jpg is corrected to 13:20 and reads three hours past that, which is
  // what a photo Google Photos placed in another zone looks like. It is written,
  // and the report carries the distance so a column of identical numbers still
  // gives the timezone away.
  const album = createFakeAlbum([{ key: 'p1', fileName: '01001519.jpg', shows: '2026:08:16 16:20:00' }]);
  const { outcome, results } = await run(album, TWO_CORRECTIONS);

  assert.equal(outcome.edited, 1);
  assert.equal(results[0]?.minutesOff, 180);
  assert.equal(album.saved[0]?.zone.offsetMinutes, 0);
});

test('a dialog that never opens is reported, and the walk carries on', async () => {
  const album = createFakeAlbum(THREE_PHOTOS, { dialogOpens: false });
  const { outcome } = await run(album, TWO_CORRECTIONS);

  assert.equal(outcome.dialogUnavailable, 2);
  assert.equal(outcome.visited, 3);
  assert.equal(outcome.reason, 'end-of-album');
});

test('boxes that will not take the value stop the run before it presses Save', async () => {
  // Google Photos puts the old value back when it cannot parse the new one.
  // Pressing Save then would confirm a change that never happened, or a half
  // applied one where the day moved and the hour did not.
  const album = createFakeAlbum(THREE_PHOTOS, { boxesRefuse: true });
  const { outcome } = await run(album, TWO_CORRECTIONS);

  assert.equal(outcome.saveFailed, 2);
  assert.equal(outcome.edited, 0);
  assert.deepEqual(album.saved, []);
});

test('a failed save names the step that stopped it', async () => {
  // Four things can stop a change, and they need different fixes. A bare
  // "save-failed" sends the next person looking in the wrong place.
  const refusingChooser = createFakeAlbum(THREE_PHOTOS, { chooserRefuses: true });
  const byChooser = await run(refusingChooser, TWO_CORRECTIONS);
  assert.equal(byChooser.results[0]?.failedAt, 'timezone');

  const refusingBoxes = createFakeAlbum(THREE_PHOTOS, { boxesRefuse: true });
  const byBoxes = await run(refusingBoxes, TWO_CORRECTIONS);
  assert.equal(byBoxes.results[0]?.failedAt, 'numbers');

  const deadButton = createFakeAlbum(THREE_PHOTOS, { saveWorks: false });
  const byButton = await run(deadButton, TWO_CORRECTIONS);
  assert.equal(byButton.results[0]?.failedAt, 'dialog-stayed-open');
});

test('a Save that does nothing is reported as failed, never as done', async () => {
  const album = createFakeAlbum(THREE_PHOTOS, { saveWorks: false });
  const { outcome } = await run(album, TWO_CORRECTIONS);

  assert.equal(outcome.saveFailed, 2);
  assert.equal(outcome.edited, 0);
});

test('no dialog is left open when the walk moves on', async () => {
  // One left behind swallows the arrow key, and the next photo's edit would be
  // typed into boxes that still belong to this one.
  const album = createFakeAlbum(THREE_PHOTOS, { saveWorks: false });
  await run(album, TWO_CORRECTIONS);
  assert.equal(album.dialogOpen, false);
});

test('stops when the user presses Stop, and keeps what it already did', async () => {
  const album = createFakeAlbum(THREE_PHOTOS);
  const { outcome } = await run(album, TWO_CORRECTIONS, { shouldStop: () => true });

  assert.equal(outcome.reason, 'stopped');
  assert.equal(outcome.visited, 1);
  assert.equal(album.saved.length, 1);
});

test('a viewer stuck on the last photo is only "finished" when the next control says so', async () => {
  const stuck = createFakeAlbum(THREE_PHOTOS, { nextControlAtEnd: 'enabled' });
  assert.equal((await run(stuck, TWO_CORRECTIONS)).outcome.reason, 'stuck');

  const finished = createFakeAlbum(THREE_PHOTOS, { nextControlAtEnd: 'disabled' });
  assert.equal((await run(finished, TWO_CORRECTIONS)).outcome.reason, 'end-of-album');

  // A control that is simply absent proves nothing: the page may still be drawing.
  const ambiguous = createFakeAlbum(THREE_PHOTOS, { nextControlAtEnd: 'missing' });
  assert.equal((await run(ambiguous, TWO_CORRECTIONS)).outcome.reason, 'stuck');
});

test('a viewer that closes at the end means the album is finished', async () => {
  const album = createFakeAlbum(THREE_PHOTOS, { viewerClosesAtEnd: true, nextControlAtEnd: 'enabled' });
  assert.equal((await run(album, TWO_CORRECTIONS)).outcome.reason, 'end-of-album');
});

test('asks for the info panel a different way each time the name is missing', async () => {
  // The panel is a toggle. An earlier version pressed the key and clicked the
  // button in the same request, which opened it and closed it again.
  const album = createFakeAlbum([{ key: 'p1', fileName: '', shows: '2026:08:16 14:20:32' }]);
  const { outcome } = await run(album, TWO_CORRECTIONS, { timeoutMs: 4000 });

  assert.equal(outcome.unreadable, 1);
  assert.ok(album.infoPanelAttempts.length > 1);
  assert.deepEqual(album.infoPanelAttempts.slice(0, 2), [0, 1]);
});

test('a skipped photo says which guard was still holding', async () => {
  // "unreadable" on its own sends the user looking at the wrong thing. A panel
  // that showed nothing is a panel problem; two photos sharing a name is not.
  const noName = createFakeAlbum([{ key: 'p1', fileName: '', shows: '2026:08:16 14:20:32' }]);
  const first = await run(noName, TWO_CORRECTIONS, { timeoutMs: 4000 });
  assert.equal(first.results[0]?.unreadableBecause, 'no-name');
  assert.equal(first.results[0]?.fileName, null);

  // Guard 1 cannot tell a genuine repeat from a panel that has not redrawn, so
  // the second of two photos with one name is skipped. The name still comes out,
  // because it is what lets the user find the photo.
  const twins = createFakeAlbum([
    { key: 'p1', fileName: '01001519.jpg', shows: '2026:08:16 14:20:32' },
    { key: 'p2', fileName: '01001519.jpg', shows: '2026:08:16 14:20:32' },
  ]);
  const second = await run(twins, TWO_CORRECTIONS, { timeoutMs: 4000 });
  assert.equal(second.outcome.unreadable, 1);
  assert.equal(second.results[1]?.unreadableBecause, 'same-as-previous');
  assert.equal(second.results[1]?.fileName, '01001519.jpg');
});

test('a viewer with no photo open reports it instead of walking nothing', async () => {
  const album = createFakeAlbum([]);
  const { outcome } = await run(album, TWO_CORRECTIONS);
  assert.equal(outcome.reason, 'no-photo-open');
});

test('the ExifTool form is what the report shows for a photo it changed', async () => {
  const album = createFakeAlbum(THREE_PHOTOS);
  const { results } = await run(album, TWO_CORRECTIONS);
  assert.equal(results[0]?.wanted, '2026:08:16 13:20');
  assert.equal(
    results[0]?.shown,
    formatExifDateTime({ year: 2026, month: 8, day: 16, hour: 14, minute: 20, second: 0 }) + ' GMT+02:00',
  );
});
