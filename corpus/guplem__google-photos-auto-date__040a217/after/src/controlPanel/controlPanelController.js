/**
 * The small panel that appears at the bottom left of an album page.
 *
 * It takes the corrections file, starts and stops a run, shows the progress, and
 * copies the report. The report matters: it names every photo the run refused to
 * touch and every file in your list that the album never showed, which is the
 * only way to know a run was complete.
 */

const ROOT_CLASS = 'gpad-root';

/**
 * @typedef {object} ControlPanelDeps
 * @property {Document} document
 * @property {(file: File) => void} onListFileChosen
 * @property {(dryRun: boolean) => void} onDryRunChanged
 * @property {() => void} onRunStart
 * @property {() => void} onRunStop
 * @property {() => void} onOpenOptions
 * @property {() => Promise<string>} onBuildReport
 */

/**
 * @param {Document} ownerDocument
 * @param {string} tagName
 * @param {string} className
 * @param {string} [text]
 */
function createElement(ownerDocument, tagName, className, text) {
  const element = ownerDocument.createElement(tagName);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

/**
 * @param {ControlPanelDeps} deps
 */
export function createControlPanel({
  document: ownerDocument,
  onListFileChosen,
  onDryRunChanged,
  onRunStart,
  onRunStop,
  onOpenOptions,
  onBuildReport,
}) {
  const root = createElement(ownerDocument, 'div', ROOT_CLASS);
  root.setAttribute('data-gpad-collapsed', 'true');

  const toggle = createElement(ownerDocument, 'button', 'gpad-toggle', 'auto Date');
  toggle.setAttribute('type', 'button');

  const body = createElement(ownerDocument, 'div', 'gpad-body');
  const listSummary = createElement(ownerDocument, 'p', 'gpad-summary', 'No corrections loaded yet.');
  const message = createElement(ownerDocument, 'p', 'gpad-message');

  const fileLabel = createElement(ownerDocument, 'label', 'gpad-file');
  const fileInput = /** @type {HTMLInputElement} */ (ownerDocument.createElement('input'));
  fileInput.type = 'file';
  fileInput.accept = '.json,application/json';
  fileLabel.append(createElement(ownerDocument, 'span', 'gpad-file-text', 'Choose corrections file'), fileInput);

  const dryRunLabel = createElement(ownerDocument, 'label', 'gpad-check');
  const dryRunInput = /** @type {HTMLInputElement} */ (ownerDocument.createElement('input'));
  dryRunInput.type = 'checkbox';
  dryRunLabel.append(dryRunInput, createElement(ownerDocument, 'span', 'gpad-check-text', 'Dry run (change nothing)'));

  const runButton = createElement(ownerDocument, 'button', 'gpad-button gpad-button--primary', 'Start');
  runButton.setAttribute('type', 'button');

  const reportButton = createElement(ownerDocument, 'button', 'gpad-button', 'Copy report');
  reportButton.setAttribute('type', 'button');

  const optionsButton = createElement(ownerDocument, 'button', 'gpad-button', 'Options');
  optionsButton.setAttribute('type', 'button');

  const actions = createElement(ownerDocument, 'div', 'gpad-actions');
  actions.append(runButton, reportButton, optionsButton);
  body.append(listSummary, fileLabel, dryRunLabel, message, actions);
  root.append(toggle, body);

  /** @type {'idle' | 'running'} */
  let runState = 'idle';

  toggle.addEventListener('click', () => {
    const collapsed = root.getAttribute('data-gpad-collapsed') === 'true';
    root.setAttribute('data-gpad-collapsed', collapsed ? 'false' : 'true');
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file !== undefined) onListFileChosen(file);
    // Clearing the value lets the user pick the same file again after an edit.
    fileInput.value = '';
  });

  dryRunInput.addEventListener('change', () => onDryRunChanged(dryRunInput.checked));

  runButton.addEventListener('click', () => {
    if (runState === 'running') onRunStop();
    else onRunStart();
  });

  optionsButton.addEventListener('click', onOpenOptions);

  reportButton.addEventListener('click', () => void copyReport());

  /**
   * Puts the report somewhere the user can reach, and always says what happened.
   *
   * An earlier version awaited the builder outside any try, and awaited the
   * clipboard with no time limit. After a run of 1613 photos the button did
   * nothing at all, twice over: a throw inside the builder became an unhandled
   * rejection that no one saw, and `writeText` can sit unresolved for ever when
   * Chrome decides the document is not focused, so neither branch of the old
   * catch ever ran. A button that silently does nothing is worse than one that
   * fails, because the run it was reporting on cannot be repeated.
   *
   * So: every step is caught, the console gets the report before anything that
   * can fail, and the clipboard is given a deadline and two fallbacks.
   * @returns {Promise<void>}
   */
  async function copyReport() {
    panel.setMessage('Building the report...');

    /** @type {string} */
    let report;
    try {
      report = await onBuildReport();
    } catch (error) {
      console.error('[auto Date] could not build the report', error);
      panel.setMessage(`Could not build the report: ${describeError(error)}`);
      return;
    }

    // Before the clipboard, not after. Whatever happens next, it is somewhere.
    console.info('[auto Date] report:\n' + report);

    try {
      await withTimeout(ownerDocument.defaultView?.navigator.clipboard.writeText(report), CLIPBOARD_TIMEOUT_MS);
      panel.setMessage('Report copied to the clipboard.');
      return;
    } catch (error) {
      console.warn('[auto Date] the clipboard refused the report', error);
    }

    // The old way of copying. It needs no clipboard permission and no focused
    // document, only the click that is still being handled.
    if (copyThroughSelection(ownerDocument, report)) {
      panel.setMessage('Report copied to the clipboard.');
      return;
    }

    if (downloadReport(ownerDocument, report)) {
      panel.setMessage('The clipboard refused, so the report was downloaded as a file.');
      return;
    }

    panel.setMessage('The clipboard refused. The report is in the browser console (F12).');
  }

  const panel = {
    mount() {
      if (!root.isConnected) ownerDocument.body.append(root);
    },

    unmount() {
      root.remove();
    },

    /** @param {boolean} collapsed */
    setCollapsed(collapsed) {
      root.setAttribute('data-gpad-collapsed', collapsed ? 'true' : 'false');
    },

    /** @param {import('../dateEdits/modificationsListStore.js').ModificationsListRecord} record */
    setListSummary({ modifications, sourceName }) {
      listSummary.textContent =
        modifications.length === 0
          ? 'No corrections loaded yet.'
          : `${modifications.length} corrections loaded from ${sourceName || 'a file'}.`;
    },

    /** @param {boolean} dryRun */
    setDryRun(dryRun) {
      dryRunInput.checked = dryRun;
    },

    /** @param {'idle' | 'running'} next */
    setRunState(next) {
      runState = next;
      runButton.textContent = next === 'running' ? 'Stop' : 'Start';
      root.setAttribute('data-gpad-running', next === 'running' ? 'true' : 'false');
      fileInput.disabled = next === 'running';
      dryRunInput.disabled = next === 'running';
      if (next === 'running') panel.setCollapsed(false);
    },

    /** @param {string} text */
    setMessage(text) {
      message.textContent = text;
    },
  };

  return panel;
}

/** @typedef {ReturnType<typeof createControlPanel>} ControlPanel */

/** How long the clipboard gets before the fallbacks take over. */
const CLIPBOARD_TIMEOUT_MS = 2000;

/** How long the file URL is kept alive after the download starts. */
const DOWNLOAD_URL_LIFETIME_MS = 10000;

/**
 * Rejects when a promise takes too long, instead of waiting for ever.
 * @template T
 * @param {Promise<T> | undefined} promise
 * @param {number} timeoutMs
 * @returns {Promise<T>}
 */
function withTimeout(promise, timeoutMs) {
  if (promise === undefined) return Promise.reject(new Error('there is no clipboard here'));
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => setTimeout(() => reject(new Error('the clipboard never answered')), timeoutMs)),
  ]);
}

/**
 * Copies by selecting hidden text, the way pages did before the clipboard API.
 *
 * It asks for no permission and does not care whether the document is focused,
 * only that a click is being handled, which is why it is the first fallback.
 * @param {Document} ownerDocument
 * @param {string} text
 * @returns {boolean}
 */
function copyThroughSelection(ownerDocument, text) {
  const area = ownerDocument.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;';
  ownerDocument.body.append(area);
  try {
    area.select();
    return ownerDocument.execCommand('copy');
  } catch (error) {
    console.warn('[auto Date] could not copy through a selection', error);
    return false;
  } finally {
    area.remove();
  }
}

/**
 * Hands the report over as a file, which a clipboard cannot refuse.
 * @param {Document} ownerDocument
 * @param {string} text
 * @returns {boolean}
 */
function downloadReport(ownerDocument, text) {
  const view = ownerDocument.defaultView;
  if (view === null) return false;

  const url = view.URL.createObjectURL(new view.Blob([text], { type: 'application/json' }));
  try {
    const link = ownerDocument.createElement('a');
    link.href = url;
    link.download = `auto-date-report-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.json`;
    ownerDocument.body.append(link);
    link.click();
    link.remove();
    return true;
  } catch (error) {
    console.warn('[auto Date] could not download the report', error);
    return false;
  } finally {
    setTimeout(() => view.URL.revokeObjectURL(url), DOWNLOAD_URL_LIFETIME_MS);
  }
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}
