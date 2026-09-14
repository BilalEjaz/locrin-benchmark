/**
 * Walks an album one photo at a time. For every photo whose file name is in the
 * list of corrections, it opens the "edit date and time" dialog, types the
 * corrected date and time, and presses Save.
 *
 * This file holds no DOM code. Every browser action arrives as a function, which
 * keeps the walk testable and keeps the fragile selectors in the adapters.
 *
 * ## The one rule that matters: never act on a stale reading
 *
 * The address bar changes the moment Google Photos accepts the arrow key, but
 * the info panel redraws a little later. So right after a move, the page still
 * shows the **previous** photo's file name. An edit made then would rewrite the
 * date of the wrong photo, and nothing on screen would show the mistake.
 *
 * Three guards prevent it, and all three must pass before the dialog opens:
 *
 *  1. The file name must differ from the last one we accepted.
 *  2. The same file name must hold for `confirmMs` without changing.
 *  3. At least `minDwellMs` must have passed since the photo opened.
 *
 * A fourth guard sits inside the dialog, and it is the strongest one: the dialog
 * must already show the timestamp the list says this file has. `dateEditPlan.js`
 * checks that, and refuses otherwise. So even a dialog belonging to another
 * photo is caught, because its date would not be the one we expect.
 *
 * When the guards do not pass inside `timeoutMs`, the photo is reported and the
 * walk moves on. A skipped photo costs the user one manual edit, which the
 * report names. A wrong edit overwrites a timestamp with no record of what it
 * used to be. The timing always chooses the skip.
 *
 * A side effect of guard 1: two photos in a row with the same file name are both
 * reported `unreadable`. That is rare in one album, and it is the safe outcome.
 */

/**
 * @typedef {import('./modificationsList.js').DateModification} DateModification
 * @typedef {import('./dateEditPlan.js').DateEditPlan} DateEditPlan
 * @typedef {import('./dateDialogFields.js').DialogPartValues} DialogPartValues
 * @typedef {import('./dateDialogFields.js').DialogPartIndexes} DialogPartIndexes
 * @typedef {import('./dateEditPlan.js').DialogTimeZone} DialogTimeZone
 *
 * @typedef {'edited' | 'would-edit' | 'already-correct' | 'unexpected-current' | 'not-in-list' | 'unreadable' | 'dialog-unavailable' | 'save-failed'} PhotoAction
 *
 * @typedef {object} PhotoResult
 * @property {string} photoKey
 * @property {string | null} fileName
 * @property {PhotoAction} action
 * @property {string | null} shown        What the dialog read as, in ExifTool form.
 * @property {string | null} wanted       What the list asked for, in ExifTool form.
 * @property {number | null} minutesOff   How far the dialog was from what the list expected.
 * @property {SaveFailure | null} failedAt  Which step stopped a change that was meant to happen.
 *
 * @typedef {'timezone' | 'numbers' | 'save-button' | 'dialog-stayed-open'} SaveFailure
 *
 * @typedef {object} RunCounts
 * @property {number} visited            Photos the walk reached.
 * @property {number} edited             Photos this run changed.
 * @property {number} wouldEdit          Photos a dry run would have changed.
 * @property {number} alreadyCorrect     Photos that already showed the corrected timestamp.
 * @property {number} unexpectedCurrent  Photos whose current timestamp is not the one the list expects.
 * @property {number} timeZoneUnreadable Photos whose dialog offered no timezone the extension could read.
 * @property {number} notInList          Photos whose file name is not in the list.
 * @property {number} unreadable         Photos whose file name never settled.
 * @property {number} dialogUnavailable  Photos where the dialog never opened, or showed boxes we cannot name.
 * @property {number} saveFailed         Photos where the change was typed but the page did not keep it.
 *
 * @typedef {'end-of-album' | 'stopped' | 'loop-detected' | 'no-photo-open' | 'stuck'} RunStopReason
 *
 * @typedef {object} RunOutcomeExtras
 * @property {RunStopReason} reason
 * @property {'enabled' | 'disabled' | 'missing' | null} nextControlState  The next control when the walk ended.
 *
 * @typedef {RunCounts & RunOutcomeExtras} RunOutcome
 *
 * @typedef {object} AlbumDateEditingRunDeps
 * @property {() => string | null} readCurrentPhotoKey  Photo id currently in the address bar.
 * @property {() => string | null} readFileName  The file name on screen; null means "cannot tell yet".
 * @property {(fileName: string) => DateModification | null} findModification  The correction for this file, if any.
 * @property {() => boolean} isAnyDialogOpen   True while any dialog covers the page.
 * @property {() => boolean} isEditDialogOpen  True while the date dialog is open and readable.
 * @property {(modification: DateModification) => boolean} openEditDialog  Press the control that opens the dialog.
 * @property {() => { reading: DialogPartValues, parts: DialogPartIndexes, timeZone: DialogTimeZone | null } | null} readEditDialog
 * @property {(reading: DialogPartValues, timeZone: DialogTimeZone | null, modification: DateModification) => DateEditPlan} planEdit
 * @property {(values: DialogPartValues) => boolean} writeEditDialog
 * @property {(offsetMinutes: number) => Promise<boolean>} setEditDialogTimeZone
 * @property {() => boolean} saveEditDialog
 * @property {() => void} closeEditDialog
 * @property {(attempt: number) => void} requestInfoPanel  Ask Google Photos to show the info panel, one method per attempt number.
 * @property {() => 'enabled' | 'disabled' | 'missing'} readNextControlState
 * @property {(attempt: number) => Promise<void>} requestNextPhoto  Ask the page to move on, one method per attempt number.
 * @property {() => void} keepPageAwake  Make the page show its viewer chrome again.
 * @property {(milliseconds: number) => Promise<void>} wait
 * @property {() => number} now
 * @property {(result: PhotoResult) => void} onResult
 * @property {(counts: RunCounts) => void} onProgress
 * @property {() => boolean} shouldStop
 * @property {number} pollMs         How often to read the page.
 * @property {number} minDwellMs     Ignore readings taken this soon after a photo opens.
 * @property {number} confirmMs      How long one reading must hold before we believe it.
 * @property {number} timeoutMs      Give up on one photo after this long.
 * @property {number} saveConfirmMs  How long to wait for Google Photos to accept the change.
 * @property {boolean} dryRun        Report what would change and type nothing.
 */

/**
 * How long we wait for the address bar to show the next photo, per attempt.
 *
 * The list is also the attempt count, and it backs off on purpose. The address
 * bar usually updates as soon as the app accepts the key, so the first window is
 * short and the common case stays fast. A window only grows when the album has
 * not loaded the next page yet, and Google Photos loads an album in pages.
 */
const ADVANCE_ATTEMPT_TIMEOUTS_MS = [1200, 2500, 2500, 5000];

/**
 * The shortest time one photo may take, in milliseconds.
 *
 * Google Photos loads an album in pages. Without a floor the walk steps through
 * photos far faster than a person, arrives past the loaded edge, and then
 * reports a stall it caused itself.
 */
export const MIN_PHOTO_INTERVAL_MS = 120;

/** How often we look at the address bar while waiting for the next photo. */
const ADVANCE_POLL_MS = 25;

/**
 * How often to ask for the info panel while the file name is missing.
 *
 * The panel is a toggle, so asking on every poll would open and close it in a
 * loop. One request, then a pause long enough for the panel to draw.
 */
const INFO_PANEL_RETRY_MS = 1200;

/**
 * How often to press the control that opens the date dialog.
 *
 * Same reason as the info panel: the dialog takes a moment to appear, and a
 * second press while it is appearing would land on whatever is underneath.
 */
const DIALOG_REQUEST_RETRY_MS = 900;

/** How long to let a dialog finish closing before the walk carries on. */
const DIALOG_CLOSE_WAIT_MS = 200;

/**
 * @param {AlbumDateEditingRunDeps} deps
 * @returns {Promise<RunOutcome>}
 */
export async function runAlbumDateEditing(deps) {
  const { readCurrentPhotoKey, readFileName, requestNextPhoto, wait, now } = deps;

  /** @type {Set<string>} */
  const visited = new Set();

  /** @type {RunCounts} */
  const counts = {
    visited: 0,
    edited: 0,
    wouldEdit: 0,
    alreadyCorrect: 0,
    unexpectedCurrent: 0,
    timeZoneUnreadable: 0,
    notInList: 0,
    unreadable: 0,
    dialogUnavailable: 0,
    saveFailed: 0,
  };

  /** The last file name we trusted. Guard 1 compares against it. See the note at the top. */
  let lastAcceptedFileName = /** @type {string | null} */ (null);

  /** Counts every info-panel request of the whole run, so the two methods alternate. */
  let infoPanelAttempt = 0;

  /**
   * Reads the file name until it is trustworthy.
   *
   * @param {number} arrivedAt
   * @param {number} deadline
   * @returns {Promise<string | null>}
   */
  async function readSettledFileName(arrivedAt, deadline) {
    /** @type {string | null} */
    let candidate = null;
    /** @type {number} */
    let candidateSince = 0;
    // Negative infinity, not zero: the first miss must ask at once. Zero delays
    // the first request by the whole retry gap whenever the clock starts near it.
    let lastInfoPanelRequestAt = Number.NEGATIVE_INFINITY;

    while (now() < deadline) {
      await wait(deps.pollMs);
      const current = readFileName();

      if (current === null) {
        // Either the info panel is closed, or Google Photos hid the viewer
        // chrome because the pointer stopped. Fix both, then read again.
        deps.keepPageAwake();
        if (now() - lastInfoPanelRequestAt >= INFO_PANEL_RETRY_MS) {
          lastInfoPanelRequestAt = now();
          deps.requestInfoPanel(infoPanelAttempt);
          infoPanelAttempt += 1;
        }
        candidate = null;
        continue;
      }

      // Guard 1: the panel still shows the photo we just left.
      if (current === lastAcceptedFileName) {
        candidate = null;
        continue;
      }

      if (current !== candidate) {
        candidate = current;
        candidateSince = now();
        continue;
      }

      // Guards 2 and 3.
      if (now() - candidateSince >= deps.confirmMs && now() - arrivedAt >= deps.minDwellMs) return candidate;
    }

    return null;
  }

  /**
   * Gets the date dialog open.
   *
   * Some other dialog being open is the interesting case. It hides the control
   * we need, so the two actions alternate: close what is there, then press the
   * control, then close again if that opened the wrong thing.
   * @param {number} deadline
   * @param {DateModification} modification  Passed on, so the opener can pick the row that shows this photo's timestamp.
   * @returns {Promise<boolean>}
   */
  async function openDialog(deadline, modification) {
    let lastRequestAt = Number.NEGATIVE_INFINITY;

    while (now() < deadline) {
      if (deps.isEditDialogOpen()) return true;

      deps.keepPageAwake();
      if (now() - lastRequestAt >= DIALOG_REQUEST_RETRY_MS) {
        lastRequestAt = now();
        if (deps.isAnyDialogOpen()) deps.closeEditDialog();
        else deps.openEditDialog(modification);
      }
      await wait(deps.pollMs);
    }

    return false;
  }

  /**
   * Reads the dialog until the same five values hold for `confirmMs`.
   *
   * The dialog animates in, and Google Photos fills the boxes a frame after it
   * draws them, so the first reading is often an empty box or a leftover value.
   * @param {number} deadline
   * @returns {Promise<{ reading: DialogPartValues, parts: DialogPartIndexes, timeZone: DialogTimeZone | null } | null>}
   */
  async function readSettledDialog(deadline) {
    /** @type {string | null} */
    let candidate = null;
    /** @type {number} */
    let candidateSince = 0;

    while (now() < deadline) {
      const current = deps.readEditDialog();

      if (current === null) {
        candidate = null;
      } else {
        const { year, month, day, hour, minute } = current.reading;
        const key = `${year}-${month}-${day} ${hour}:${minute} ${current.timeZone?.text ?? ''}`;
        if (key !== candidate) {
          candidate = key;
          candidateSince = now();
        } else if (now() - candidateSince >= deps.confirmMs) {
          return current;
        }
      }

      await wait(deps.pollMs);
    }

    return null;
  }

  /**
   * Types the new values and waits for Google Photos to take them.
   *
   * The dialog closing is the confirmation. While it is still open, either the
   * page rejected the value or the Save button did nothing, and both mean the
   * change did not happen.
   * The timezone goes first. Changing it can redraw the dialog and recompute the
   * numbers, so the numbers are typed afterwards and read back, which leaves the
   * five boxes holding what we meant whichever way the page behaves.
   * @param {DateEditPlan} plan
   * @param {number} deadline
   * @returns {Promise<SaveFailure | null>} Null when the change went through, otherwise the step that stopped it.
   */
  async function applyPlan(plan, deadline) {
    deps.keepPageAwake();

    if (plan.timeZoneOffsetMinutes !== null && !(await deps.setEditDialogTimeZone(plan.timeZoneOffsetMinutes))) return 'timezone';
    if (!deps.writeEditDialog(/** @type {DialogPartValues} */ (plan.values))) return 'numbers';
    if (!deps.saveEditDialog()) return 'save-button';

    while (now() < deadline) {
      await wait(deps.pollMs);
      if (!deps.isEditDialogOpen()) return null;
    }
    return 'dialog-stayed-open';
  }

  /**
   * Decides and performs what happens to the photo on screen.
   * @param {string} photoKey
   * @returns {Promise<PhotoResult>}
   */
  async function handleCurrentPhoto(photoKey) {
    const arrivedAt = now();
    const deadline = arrivedAt + deps.timeoutMs;

    const empty = { shown: null, wanted: null, minutesOff: null, failedAt: null };

    const fileName = await readSettledFileName(arrivedAt, deadline);
    if (fileName === null) return { photoKey, fileName: null, action: 'unreadable', ...empty };

    lastAcceptedFileName = fileName;

    const modification = deps.findModification(fileName);
    if (modification === null) return { photoKey, fileName, action: 'not-in-list', ...empty };

    /**
     * @param {PhotoAction} action
     * @param {DateEditPlan | null} plan
     * @param {SaveFailure | null} [failedAt]
     * @returns {PhotoResult}
     */
    const result = (action, plan, failedAt = null) => ({
      photoKey,
      fileName,
      action,
      shown: plan?.shown ?? null,
      wanted: describeWanted(modification),
      minutesOff: plan?.minutesOff ?? null,
      failedAt,
    });

    if (!(await openDialog(deadline, modification))) return result('dialog-unavailable', null);

    const opened = await readSettledDialog(deadline);
    if (opened === null) return result('dialog-unavailable', null);

    // Counted, not fatal. The run carries on and still puts the numbers right,
    // but a photo whose offset was never checked is not a photo known to be
    // finished, and the report has to say so.
    if (opened.timeZone === null || opened.timeZone.offsetMinutes === null) counts.timeZoneUnreadable += 1;

    const plan = deps.planEdit(opened.reading, opened.timeZone, modification);
    if (plan.verdict !== 'write') return result(plan.verdict, plan);
    if (deps.dryRun) return result('would-edit', plan);

    const failedAt = await applyPlan(plan, now() + deps.saveConfirmMs);
    return failedAt === null ? result('edited', plan) : result('save-failed', plan, failedAt);
  }

  /**
   * Moves to the next photo, trying each available method in turn.
   * @param {string} currentPhotoKey
   * @returns {Promise<string | null>} The new photo id, or null when nothing worked.
   */
  async function advancePastPhoto(currentPhotoKey) {
    for (const [attempt, attemptTimeoutMs] of ADVANCE_ATTEMPT_TIMEOUTS_MS.entries()) {
      // The next control is part of the chrome that hides with the pointer.
      deps.keepPageAwake();
      await requestNextPhoto(attempt);

      const attemptDeadline = now() + attemptTimeoutMs;
      while (now() < attemptDeadline) {
        await wait(ADVANCE_POLL_MS);
        const key = readCurrentPhotoKey();
        if (key === null) return null;
        if (key !== currentPhotoKey) return key;
      }
    }
    return null;
  }

  /**
   * @param {RunStopReason} reason
   * @returns {RunOutcome}
   */
  const outcome = (reason) => ({
    ...counts,
    reason,
    // Only meaningful when the walk could not continue, but it is cheap and it
    // is exactly what a stall report needs.
    nextControlState: reason === 'stuck' || reason === 'end-of-album' ? deps.readNextControlState() : null,
  });

  /** @param {PhotoAction} action */
  function countAction(action) {
    if (action === 'edited') counts.edited += 1;
    else if (action === 'would-edit') counts.wouldEdit += 1;
    else if (action === 'already-correct') counts.alreadyCorrect += 1;
    else if (action === 'unexpected-current') counts.unexpectedCurrent += 1;
    else if (action === 'not-in-list') counts.notInList += 1;
    else if (action === 'dialog-unavailable') counts.dialogUnavailable += 1;
    else if (action === 'save-failed') counts.saveFailed += 1;
    else counts.unreadable += 1;
  }

  let photoKey = readCurrentPhotoKey();
  if (photoKey === null) return outcome('no-photo-open');

  for (;;) {
    if (visited.has(photoKey)) return outcome('loop-detected');
    visited.add(photoKey);

    const photoStartedAt = now();
    const result = await handleCurrentPhoto(photoKey);

    // Whatever happened above, the dialog must not survive this photo. One left
    // open swallows the arrow key, and the next photo's edit would be typed into
    // boxes that still belong to this one.
    if (deps.isAnyDialogOpen()) {
      deps.closeEditDialog();
      await wait(DIALOG_CLOSE_WAIT_MS);
    }

    counts.visited = visited.size;
    countAction(result.action);
    deps.onResult(result);
    deps.onProgress({ ...counts });

    if (deps.shouldStop()) return outcome('stopped');

    // Hold the floor, counting whatever this photo already spent. See MIN_PHOTO_INTERVAL_MS.
    const spentOnPhoto = now() - photoStartedAt;
    if (spentOnPhoto < MIN_PHOTO_INTERVAL_MS) await wait(MIN_PHOTO_INTERVAL_MS - spentOnPhoto);

    const nextPhotoKey = await advancePastPhoto(photoKey);
    if (nextPhotoKey === null) {
      // The viewer closed, so there is nothing left to read.
      if (readCurrentPhotoKey() === null) return outcome('end-of-album');

      // The viewer is still open on the same photo. Google Photos does exactly
      // that on the last photo of an album, so "cannot advance" is not proof of
      // a stall. Only a next control that is present and disabled proves the
      // album ended. Anything else stays `stuck`, because a run that claims to
      // be complete without that proof leaves the user believing every photo in
      // the list was handled.
      return outcome(deps.readNextControlState() === 'disabled' ? 'end-of-album' : 'stuck');
    }
    photoKey = nextPhotoKey;
  }
}

/**
 * @param {DateModification} modification
 * @returns {string}
 */
function describeWanted(modification) {
  const { year, month, day, hour, minute } = modification.corrected;
  const two = (/** @type {number} */ value) => String(value).padStart(2, '0');
  return `${year}:${two(month)}:${two(day)} ${two(hour)}:${two(minute)}`;
}
