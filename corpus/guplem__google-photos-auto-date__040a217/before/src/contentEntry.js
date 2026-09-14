/**
 * Entry point of the page half of the extension. Runs in the isolated world, so
 * it can use `chrome.*` APIs and can read the DOM, but cannot see the page's own
 * JavaScript variables.
 *
 * Responsibilities, in order:
 *   1. Load the settings and the list of corrections.
 *   2. Follow the single-page-app navigation and keep track of which album is open.
 *   3. Walk the album and correct the date of every photo the list names.
 *   4. Draw the control panel.
 */

import { DEFAULT_SETTINGS, loadSettings, saveSettings } from './settings/extensionSettings.js';
import { isAlbumContext, readGooglePhotosLocation, findGridPhotoLinks } from './googlePhotosPage.js';
import { CONTROL_SELECTOR, createDomHelpers, readControlName } from './domControls.js';
import { createModificationsListStore, createEmptyListRecord, readModifications } from './dateEdits/modificationsListStore.js';
import { createModificationsLookup, parseModificationsFile } from './dateEdits/modificationsList.js';
import { collectVisibleFileNames, readCurrentFileName } from './dateEdits/photoFileNameReader.js';
import { createPhotoViewerNavigator } from './dateEdits/photoViewerNavigator.js';
import { createDateEditDialog } from './dateEdits/dateEditDialog.js';
import { planDateEdit } from './dateEdits/dateEditPlan.js';
import { FALLBACK_LOCALES } from './dateEdits/dateTimeFieldFormat.js';
import { runAlbumDateEditing } from './dateEdits/albumDateEditingRun.js';
import { createControlPanel } from './controlPanel/controlPanelController.js';
import { buildRunReport } from './runReport.js';

/** How often we check whether the single-page app changed the address bar. */
const LOCATION_POLL_MS = 300;

/** How long the virtualised album grid needs to redraw after a scroll, in milliseconds. */
const GRID_REDRAW_WAIT_MS = 500;

/** How long to let the viewer settle after it opens, before the walk starts reading. */
const VIEWER_OPEN_WAIT_MS = 800;

/** How often a run may photograph the page while it cannot find the date dialog. */
const DIALOG_SNAPSHOT_INTERVAL_MS = 500;

/**
 * @param {number} milliseconds
 * @returns {Promise<void>}
 */
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * The languages to try when reading the date format, the page's own first.
 *
 * Google Photos writes the dialog in the account's language, which is usually
 * but not always the browser's. The fallbacks cover the rest, and a wrong guess
 * costs nothing: a format that does not reproduce the text on screen is dropped.
 * @returns {string[]}
 */
function readPageLocales() {
  return [navigator.language, ...navigator.languages, ...FALLBACK_LOCALES];
}

export async function start() {
  const listStore = createModificationsListStore(chrome.storage.local);

  /** @type {import('./settings/extensionSettings.js').ExtensionSettings} */
  let settings = DEFAULT_SETTINGS;
  /** @type {import('./dateEdits/modificationsListStore.js').ModificationsListRecord} */
  let listRecord = createEmptyListRecord();
  /** @type {import('./dateEdits/modificationsList.js').ModificationsLookup} */
  let lookup = createModificationsLookup([]);

  let running = false;
  let stopRequested = false;
  let lastHref = '';
  /** @type {import('./dateEdits/albumDateEditingRun.js').RunOutcome | null} */
  let lastRunOutcome = null;
  /** @type {import('./dateEdits/albumDateEditingRun.js').PhotoResult[]} */
  let lastRunResults = [];

  /**
   * What the page looked like the last time a run pressed the date row and could
   * not find the dialog afterwards.
   *
   * Without this, a report taken after the run says only "no dialog", which is
   * the one thing already known. The richest snapshot of the run is kept, because
   * the useful one is whichever caught the editor actually on screen.
   * @type {{ seenAt: string, snapshot: import('./dateEdits/dateEditDialog.js').PageSnapshot } | null}
   */
  let lastUnreadableDialog = null;

  /** Counts the moments a run found some dialog open but could not read it. */
  let unreadableDialogSightings = 0;

  /** When the last diagnostic snapshot was taken, so polling does not take one every 40ms. */
  let lastSnapshotAt = 0;

  /**
   * True when the dialog is open and readable. When it is not, this is also the
   * moment worth photographing, so the report can explain why.
   *
   * The snapshot walks the whole document, so it is throttled: the run asks this
   * question many times a second, and one picture per half second is plenty to
   * catch an editor that is on screen.
   * @returns {boolean}
   */
  function checkEditDialogReadable() {
    if (editDialog.isEditDialogOpen()) return true;
    captureDialogSnapshot(false);
    return false;
  }

  /**
   * Photographs the page, keeping the most useful picture of the run.
   *
   * "Most useful" means a dialog was open: a snapshot with none in it is the one
   * thing already known. Once such a picture is kept there is nothing better to
   * find, so the walk stops paying for snapshots entirely.
   *
   * @param {boolean} whileDialogOpen True when the caller knows a dialog is on screen.
   */
  function captureDialogSnapshot(whileDialogOpen) {
    if ((lastUnreadableDialog?.snapshot.dialogCount ?? 0) > 0) return;

    // The rate limit exists for the common, useless case. A picture taken while
    // the dialog is open is the one worth having, and the dialog is only open
    // for a few hundred milliseconds: rate limiting that one threw away every
    // snapshot that would have answered anything.
    const at = Date.now();
    if (!whileDialogOpen && at - lastSnapshotAt < DIALOG_SNAPSHOT_INTERVAL_MS) return;
    lastSnapshotAt = at;

    const snapshot = editDialog.describePage();
    if (snapshot.dialogCount === 0 && snapshot.fields.length === 0) return;

    unreadableDialogSightings += 1;

    const best = lastUnreadableDialog?.snapshot;
    const better = best === undefined || snapshot.dialogCount > best.dialogCount || snapshot.fields.length > best.fields.length;
    if (better) lastUnreadableDialog = { seenAt: new Date().toISOString(), snapshot };
  }

  // Both of these read their labels once, so both are rebuilt whenever the
  // settings change.
  let viewerNavigator = createPhotoViewerNavigator(window, settings.infoLabels);
  let editDialog = createDateEditDialog(window, settings, readPageLocales());

  /** @returns {import('./dateEdits/photoFileNameReader.js').FileNameReaderDeps} */
  function buildFileNameReaderDeps() {
    return { root: document, isVisible: createDomHelpers(window).isVisible };
  }

  /**
   * Every control the page shows right now, for the report.
   * @returns {string[]}
   */
  function collectControlNames() {
    const { isVisible } = createDomHelpers(window);
    /** @type {Set<string>} */
    const names = new Set();
    for (const control of document.querySelectorAll(CONTROL_SELECTOR)) {
      if (!isVisible(control)) continue;
      const name = readControlName(control);
      if (name !== '') names.add(name);
    }
    return [...names];
  }

  /** @returns {Promise<string>} */
  async function buildReport() {
    const report = buildRunReport({
      extensionVersion: chrome.runtime.getManifest().version,
      url: location.href,
      pageLocation: readGooglePhotosLocation(location.href),
      gridPhotoLinks: findGridPhotoLinks(document).length,
      listFileNames: lookup.fileNames,
      results: lastRunResults,
      lastRunOutcome,
      locales: readPageLocales(),
      controlNames: collectControlNames(),
      visibleFileNames: collectVisibleFileNames(buildFileNameReaderDeps()),
      dialogFields: editDialog.describeFields(),
      editControlFound: editDialog.findEditControl() !== null,
      timestampControlNames: editDialog.describeTimestampControls(),
      pageSnapshot: editDialog.describePage(),
      lastUnreadableDialog,
      unreadableDialogSightings,
      anyDialogOpen: editDialog.isAnyDialogOpen(),
      nextControlState: viewerNavigator.readNextControlState(),
      viewport: { width: window.innerWidth, height: window.innerHeight },
    });
    return JSON.stringify(report, null, 2);
  }

  const panel = createControlPanel({
    document,
    onListFileChosen: (file) => void loadListFile(file),
    onDryRunChanged: (dryRun) => void applyDryRun(dryRun),
    onRunStart: () => void runOverAlbum(),
    onRunStop: () => {
      stopRequested = true;
      panel.setMessage('Stopping after the current photo.');
    },
    onOpenOptions: () => void chrome.runtime.sendMessage({ type: 'open-options' }),
    onBuildReport: buildReport,
  });

  /**
   * @param {File} file
   * @returns {Promise<void>}
   */
  async function loadListFile(file) {
    try {
      const { modifications, skipped } = parseModificationsFile(await file.text());
      if (modifications.length === 0) {
        panel.setMessage('That file holds no usable corrections.');
        return;
      }

      listRecord = await listStore.write(modifications, file.name);
      lookup = createModificationsLookup(readModifications(listRecord));
      panel.setListSummary(listRecord);

      const skippedNote = skipped.length === 0 ? '' : ` ${skipped.length} entries were skipped, see Copy report.`;
      if (skipped.length > 0) console.info('[auto Date] skipped entries:\n' + skipped.join('\n'));
      panel.setMessage(`Loaded ${modifications.length} corrections.${skippedNote} Open the album and press Start.`);
    } catch (error) {
      console.error('[auto Date] could not read the list file', error);
      panel.setMessage(error instanceof Error ? error.message : 'Could not read that file.');
    }
  }

  /**
   * @param {boolean} dryRun
   * @returns {Promise<void>}
   */
  async function applyDryRun(dryRun) {
    settings = await saveSettings(chrome.storage.sync, { dryRun });
    panel.setMessage(
      dryRun ? 'Dry run on. A run will change nothing.' : 'Dry run off. A run will rewrite dates, and that cannot be undone.',
    );
  }

  /**
   * @param {import('./dateEdits/albumDateEditingRun.js').RunOutcome} outcome
   * @returns {string}
   */
  function describeOutcome(outcome) {
    const changed = settings.dryRun ? `${outcome.wouldEdit} would change` : `${outcome.edited} changed`;
    const notes = [
      `${outcome.alreadyCorrect} already right`,
      outcome.unexpectedCurrent > 0 ? `${outcome.unexpectedCurrent} show a different day, so they were left alone` : '',
      outcome.timeZoneUnreadable > 0 ? `${outcome.timeZoneUnreadable} had no readable timezone, so it was left alone` : '',
      outcome.dialogUnavailable > 0 ? `${outcome.dialogUnavailable} could not be opened` : '',
      outcome.unreadable > 0 ? `${outcome.unreadable} could not be read` : '',
      outcome.saveFailed > 0 ? `${outcome.saveFailed} were not saved` : '',
    ].filter((note) => note !== '');

    const tail = `${changed}, ${notes.join(', ')}. Press Copy report for the details.`;

    if (outcome.reason === 'stopped') return `Stopped after ${outcome.visited} photos. ${tail}`;
    if (outcome.reason === 'no-photo-open') return 'Could not open the viewer.';
    if (outcome.reason === 'loop-detected') return `The viewer went back to a photo it already saw. ${tail}`;
    if (outcome.reason === 'stuck') {
      return (
        `Stopped after ${outcome.visited} photos: no way to reach the next one. ${tail} ` +
        `If that is the whole album, the run is complete. If not, press Start again to carry on from here.`
      );
    }
    return `Done. Passed ${outcome.visited} photos. ${tail}`;
  }

  /** @returns {Promise<void>} */
  async function runOverAlbum() {
    if (running) return;

    if (lookup.size === 0) {
      panel.setMessage('Choose the corrections file first.');
      return;
    }

    const albumKey = readGooglePhotosLocation(location.href).albumKey;
    if (albumKey === null) {
      panel.setMessage('Open an album first.');
      return;
    }

    running = true;
    stopRequested = false;
    lastRunResults = [];
    lastUnreadableDialog = null;
    unreadableDialogSightings = 0;
    panel.setRunState('running');
    panel.setMessage('Starting.');

    try {
      // A run started with a photo already open begins there, so the user can
      // pick the starting point by hand.
      if (readGooglePhotosLocation(location.href).photoKey === null) {
        if (!(await viewerNavigator.openFirstPhoto(GRID_REDRAW_WAIT_MS))) {
          panel.setMessage('No photos found on this page.');
          return;
        }
        await wait(VIEWER_OPEN_WAIT_MS);
      }

      // The file name and the control that opens the dialog both live in the
      // info panel, so open it before the walk starts. The walk asks again
      // whenever a name is missing.
      viewerNavigator.requestInfoPanel(0);
      await wait(VIEWER_OPEN_WAIT_MS);

      const startedAt = Date.now();

      const outcome = await runAlbumDateEditing({
        readCurrentPhotoKey: () => readGooglePhotosLocation(location.href).photoKey,
        readFileName: () => readCurrentFileName(buildFileNameReaderDeps()),
        findModification: (fileName) => lookup.find(fileName),
        isAnyDialogOpen: () => editDialog.isAnyDialogOpen(),
        isEditDialogOpen: () => checkEditDialogReadable(),
        openEditDialog: (modification) => editDialog.open(modification.original),
        readEditDialog: () => {
          const opened = editDialog.read();
          // The case that needs photographing most: the dialog is open and its
          // five boxes are readable, but the timezone chooser is not among the
          // things this extension knows how to find.
          if (opened !== null && opened.timeZone === null) captureDialogSnapshot(true);
          return opened;
        },
        planEdit: (reading, timeZone, modification) => planDateEdit({ reading, timeZone, modification }),
        writeEditDialog: (values) => editDialog.write(values),
        setEditDialogTimeZone: (offsetMinutes) => editDialog.setTimeZone(offsetMinutes),
        saveEditDialog: () => {
          // The dialog as it stands the instant before Save is pressed, which is
          // the only moment that can explain a change that does not go through.
          captureDialogSnapshot(true);
          return editDialog.save();
        },
        closeEditDialog: () => editDialog.cancel(),
        requestInfoPanel: (attempt) => viewerNavigator.requestInfoPanel(attempt),
        readNextControlState: () => viewerNavigator.readNextControlState(),
        requestNextPhoto: (attempt) => viewerNavigator.requestNextPhoto(attempt),
        keepPageAwake: () => viewerNavigator.keepChromeAwake(),
        wait,
        now: () => Date.now(),
        onResult: (result) => lastRunResults.push(result),
        onProgress: (counts) => {
          const perPhoto = Math.round((Date.now() - startedAt) / counts.visited);
          const changed = settings.dryRun ? `${counts.wouldEdit} to change` : `${counts.edited} changed`;
          panel.setMessage(
            `Passed ${counts.visited}: ${changed}, ${counts.alreadyCorrect} already right, ` +
              `${counts.unexpectedCurrent + counts.unreadable + counts.dialogUnavailable} skipped. ` +
              `${perPhoto}ms each.`,
          );
        },
        shouldStop: () => stopRequested,
        pollMs: settings.pollMs,
        minDwellMs: settings.minDwellMs,
        confirmMs: settings.confirmMs,
        timeoutMs: settings.timeoutMs,
        saveConfirmMs: settings.saveConfirmMs,
        dryRun: settings.dryRun,
      });

      lastRunOutcome = outcome;
      panel.setMessage(describeOutcome(outcome));
      if (outcome.reason === 'end-of-album') viewerNavigator.closeViewer();
    } catch (error) {
      console.error('[auto Date] run failed', error);
      panel.setMessage('The run failed. See the browser console.');
    } finally {
      running = false;
      panel.setRunState('idle');
    }
  }

  /** @returns {Promise<void>} */
  async function onLocationChanged() {
    if (!isAlbumContext(readGooglePhotosLocation(location.href))) {
      if (!running) panel.unmount();
      return;
    }
    panel.mount();
  }

  /**
   * Google Photos is a single-page app: it rewrites the address bar without
   * loading a new page. Polling catches every one of those changes, including
   * the ones that fire no event.
   */
  function watchLocation() {
    const check = () => {
      if (location.href === lastHref) return;
      lastHref = location.href;
      void onLocationChanged();
    };
    window.addEventListener('popstate', check);
    setInterval(check, LOCATION_POLL_MS);
    check();
  }

  settings = await loadSettings(chrome.storage.sync);
  viewerNavigator = createPhotoViewerNavigator(window, settings.infoLabels);
  editDialog = createDateEditDialog(window, settings, readPageLocales());
  listRecord = await listStore.read();
  lookup = createModificationsLookup(readModifications(listRecord));

  panel.setListSummary(listRecord);
  panel.setDryRun(settings.dryRun);

  chrome.storage.onChanged.addListener((_changes, areaName) => {
    if (areaName !== 'sync') return;
    void loadSettings(chrome.storage.sync).then((next) => {
      settings = next;
      viewerNavigator = createPhotoViewerNavigator(window, next.infoLabels);
      editDialog = createDateEditDialog(window, next, readPageLocales());
      panel.setDryRun(next.dryRun);
    });
  });

  watchLocation();
}
