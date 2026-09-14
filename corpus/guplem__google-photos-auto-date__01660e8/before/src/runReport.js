/**
 * Builds the report that the panel copies to the clipboard.
 *
 * The report answers the questions a run cannot answer on screen. Which photos
 * did the run change, which did it refuse to touch and why, and which files in
 * the list did the album never show. Without all three, a user cannot tell a
 * complete run from a partial one.
 *
 * It also carries what a bug report needs: the names of the buttons on the page
 * and the boxes inside the dialog, so that a renamed Google Photos control can
 * be fixed from the options page.
 *
 * The report contains file names and timestamps, because those are the whole
 * signal here. Do not paste it in public if they matter to you.
 */

/**
 * @typedef {import('./dateEdits/albumDateEditingRun.js').PhotoResult} PhotoResult
 * @typedef {import('./dateEdits/albumDateEditingRun.js').PhotoAction} PhotoAction
 * @typedef {import('./dateEdits/albumDateEditingRun.js').RunOutcome} RunOutcome
 *
 * @typedef {object} RunReportInput
 * @property {string} extensionVersion
 * @property {string} url
 * @property {import('./googlePhotosPage.js').GooglePhotosLocation} pageLocation
 * @property {number} gridPhotoLinks
 * @property {readonly string[]} listFileNames      Every file name in the loaded list.
 * @property {readonly PhotoResult[]} results       One entry per photo the run reached.
 * @property {RunOutcome | null} lastRunOutcome
 * @property {readonly string[]} locales            The languages tried when recognising the info panel's date row.
 * @property {readonly string[]} controlNames       Names of the controls visible right now.
 * @property {readonly string[]} visibleFileNames
 * @property {readonly import('./dateEdits/dateDialogFields.js').DialogField[] | null} dialogFields
 * @property {boolean} editControlFound
 * @property {readonly string[]} timestampControlNames  Controls whose name is shaped like a timestamp.
 * @property {import('./dateEdits/dateEditDialog.js').PageSnapshot} pageSnapshot  Every box on the page right now.
 * @property {{ seenAt: string, snapshot: import('./dateEdits/dateEditDialog.js').PageSnapshot } | null} lastUnreadableDialog
 * @property {number} unreadableDialogSightings
 * @property {boolean} anyDialogOpen
 * @property {'enabled' | 'disabled' | 'missing'} nextControlState
 * @property {{ width: number, height: number }} viewport
 */

/**
 * @param {RunReportInput} input
 */
export function buildRunReport(input) {
  /** @type {Set<string>} */
  const seenNames = new Set();
  for (const result of input.results) {
    if (result.fileName !== null) seenNames.add(result.fileName.toLowerCase());
  }

  /** @param {PhotoAction} action */
  const withAction = (action) =>
    input.results
      .filter((result) => result.action === action)
      .map((result) => `${result.fileName ?? '(name unreadable)'}${result.shown === null ? '' : ` shows [${result.shown}]`}`);

  /**
   * The refusals worth reading one by one: what the page said against what the
   * list expected. A whole album refused this way usually means the file names
   * are matching photos they should not.
   * @param {PhotoAction} action
   */
  const refusedWithAction = (action) =>
    input.results
      .filter((result) => result.action === action)
      .map((result) => ({
        file: result.fileName,
        shows: result.shown,
        listExpectedToWrite: result.wanted,
        // For a failed save: which of the four steps stopped it.
        failedAt: result.failedAt,
        // How many tries this photo was given. Three means the page never came
        // good, which is a different problem from a page that was merely slow.
        attempts: result.attempts,
        // How far the page was from where the photo is meant to end up. Every
        // photo off by the same number of minutes means Google Photos is showing
        // the times in another timezone than the list was written in.
        minutesOff: result.minutesOff,
      }));

  return {
    extensionVersion: input.extensionVersion,
    reportedAt: new Date().toISOString(),
    page: {
      url: input.url.replace(/\/(photo|album|share)\/[^/?#]+/g, '/$1/REDACTED'),
      kind: input.pageLocation.kind,
      gridPhotoLinks: input.gridPhotoLinks,
      viewport: input.viewport,
      locales: [...input.locales],
    },
    list: {
      size: input.listFileNames.length,
      // The files the album never showed. A long list here usually means the run
      // stopped early, or that this is not the album the list came from.
      notSeenInAlbum: input.listFileNames.filter((name) => !seenNames.has(name)),
    },
    lastRun: input.lastRunOutcome,
    photos: {
      edited: withAction('edited'),
      wouldEdit: withAction('would-edit'),
      alreadyCorrect: withAction('already-correct'),
      // The photo shows a date more than a day from the corrected one, so the
      // dialog is not believed to belong to it and changing it would be a guess.
      unexpectedCurrent: refusedWithAction('unexpected-current'),
      saveFailed: refusedWithAction('save-failed'),
      dialogUnavailable: withAction('dialog-unavailable'),
      unreadable: input.results.filter((result) => result.action === 'unreadable').map((result) => result.photoKey),
    },
    // What the extension can see on the page right now. Use this when Google
    // Photos renames a control and the run stops finding it.
    page_now: {
      controlNames: [...input.controlNames],
      visibleFileNames: [...input.visibleFileNames],
      editControlFound: input.editControlFound,
      // The control that opens the date dialog is normally the info panel's date
      // row, whose name is the photo's own timestamp. These are the candidates.
      timestampControlNames: [...input.timestampControlNames],
      anyDialogOpen: input.anyDialogOpen,
      // Open the dialog by hand, then press Copy report. Every box it shows
      // appears here, with the name the extension reads and the value it holds.
      dialogFields: input.dialogFields === null ? null : input.dialogFields.map((field) => ({ ...field })),
      // Every box on the page right now, ignoring the rules the run follows.
      // Useful when the dialog is open by hand as the report is taken.
      pageSnapshot: input.pageSnapshot,
      nextControlState: input.nextControlState,
    },
    // What the page looked like during the run, at a moment when the date row had
    // been pressed and the dialog still could not be read. This is the answer to
    // "the dialog opens and nothing is written".
    dialog_during_run: {
      sightings: input.unreadableDialogSightings,
      last: input.lastUnreadableDialog,
    },
  };
}
