/**
 * Drives the Google Photos "edit date and time" dialog: opens it, reads its five
 * boxes, types the corrected numbers, and presses Save.
 *
 * Safety rules for this file, the same two the rest of the extension follows:
 *
 *  - Never click a control we cannot name. The pencil, the Save button and the
 *    Cancel button all have to match a word from the settings first.
 *  - Never leave a dialog open. A dialog left behind swallows the arrow key, so
 *    the run would stop, and worse, the next photo's edit would be typed into a
 *    box that belongs to this one. Every path out of here closes it.
 *
 * This is a thin adapter: it finds elements, reads them and clicks them. Every
 * decision it needs lives in `dateDialogFields.js` and `dateEditPlan.js`, which
 * are unit tested.
 */

import { CONTROL_SELECTOR, matchesAnyLabel, normalizeLabel } from '../domControls.js';
import { DATE_TIME_PART_NAMES, classifyDialogFields, readDialogParts } from './dateDialogFields.js';
import { chooseEditControlIndex, looksLikeTimestampName } from './dateEditControl.js';
import { chooseTimeZoneOptionIndex, chooseZoneText, parseGmtOffsetMinutes } from './dateDialogTimeZone.js';

const DIALOG_SELECTOR = '[role="dialog"], [role="alertdialog"], dialog[open]';

/** Boxes a person can type into. */
const FIELD_SELECTOR = 'input:not([type="hidden"]), textarea';

/** The timezone chooser. An ARIA combobox in Google Photos; `select` covers a plainer build. */
const CHOOSER_SELECTOR = '[role="combobox"], select';

/** One entry of an open chooser. */
const OPTION_SELECTOR = '[role="option"], option';

/**
 * The entry a chooser is currently showing.
 *
 * Spelled out in full, with the attribute repeated on both halves. Appending
 * `[aria-selected="true"]` to `OPTION_SELECTOR` would have bound it only to the
 * part after the comma, so the rule matched **every** option and the first one in
 * the page was read back as the chosen zone, whatever was actually chosen.
 */
const SELECTED_OPTION_SELECTOR = '[role="option"][aria-selected="true"], option[aria-selected="true"]';

/** How often to look while a chooser is opening or settling. */
const CHOOSER_POLL_MS = 50;

/**
 * How long to wait for the option list to appear, and then for the choice to take.
 *
 * Both were 1500ms, and one photo in a run of 231 dialogs failed at `timezone`
 * because the list of zones had not rendered by then. Waiting longer is free:
 * `waitUntil` returns the moment the page is ready, so a higher ceiling costs
 * nothing except on the photos that would otherwise have been given up on.
 */
const CHOOSER_OPEN_MS = 5000;
const CHOOSER_SETTLE_MS = 5000;

/** Longest zone label kept for the report. */
const MAX_ZONE_NAME_LENGTH = 80;

/** Roles worth reporting when the extension cannot find the dialog it expected. */
const OVERLAY_ROLES = ['dialog', 'alertdialog', 'menu', 'listbox', 'tooltip', 'alert', 'form', 'group', 'region'];

/** Caps for the diagnostic snapshot, so a report stays readable. */
const MAX_SNAPSHOT_FIELDS = 25;
const MAX_SNAPSHOT_ROLES = 40;
const MAX_SNAPSHOT_OFFSET_TEXTS = 12;
const MAX_SNAPSHOT_TEXT_LENGTH = 700;

/**
 * @typedef {import('./dateDialogFields.js').DialogField} DialogField
 * @typedef {import('./dateDialogFields.js').DialogPartIndexes} DialogPartIndexes
 * @typedef {import('./dateDialogFields.js').DialogPartValues} DialogPartValues
 * @typedef {import('./dateEditPlan.js').DialogTimeZone} DialogTimeZone
 *
 * @typedef {object} PageFieldSnapshot
 * @property {string} tag
 * @property {string} type
 * @property {string} name
 * @property {string} value
 * @property {boolean} visible
 * @property {boolean} disabled
 * @property {boolean} readOnly
 * @property {boolean} inDialog
 *
 * @typedef {object} PageSnapshot
 * @property {number} dialogCount
 * @property {string[]} dialogOffsetTexts  Every element in the dialog whose own text names a GMT offset.
 * @property {string[]} dialogTexts
 * @property {string[]} dialogButtonNames
 * @property {string[]} dialogChoosers   Each `select` in the dialog, as "name = selected option".
 * @property {string[]} dialogRoles      Each element in the dialog that carries a `role`, with its name and state.
 * @property {string[]} overlayRoles
 * @property {PageFieldSnapshot[]} fields
 *
 * @typedef {object} DateEditDialogLabels
 * @property {readonly string[]} editDateLabels     Names of the control that opens the dialog.
 * @property {readonly string[]} yearFieldLabels    Names of the year box.
 * @property {readonly string[]} monthFieldLabels   Names of the month box.
 * @property {readonly string[]} dayFieldLabels     Names of the day box.
 * @property {readonly string[]} hourFieldLabels    Names of the hour box.
 * @property {readonly string[]} minuteFieldLabels  Names of the minutes box.
 * @property {readonly string[]} timeZoneFieldLabels Names of the timezone chooser.
 * @property {readonly string[]} saveLabels         Names of the button that keeps the change.
 * @property {readonly string[]} cancelLabels       Names of the button that throws it away.
 */

/**
 * @param {Window} view
 * @param {Element} element
 * @returns {boolean}
 */
function isVisible(view, element) {
  const box = element.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0) return false;
  const style = view.getComputedStyle(element);
  return style.visibility !== 'hidden' && style.display !== 'none';
}

/**
 * @param {Element} element
 * @returns {string}
 */
function readControlName(element) {
  return normalizeLabel(element.getAttribute('aria-label') ?? element.getAttribute('title') ?? element.textContent);
}

/**
 * The name a screen reader would announce for one box.
 *
 * A box carries its name in one of four places depending on how the page was
 * built, so all four are tried before giving up.
 * @param {Document} ownerDocument
 * @param {Element} element
 * @returns {string}
 */
export function readFieldName(ownerDocument, element) {
  const ariaLabel = normalizeLabel(element.getAttribute('aria-label'));
  if (ariaLabel !== '') return ariaLabel;

  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy !== null) {
    const labels = labelledBy
      .split(/\s+/)
      .map((id) => normalizeLabel(ownerDocument.getElementById(id)?.textContent))
      .filter((text) => text !== '');
    if (labels.length > 0) return labels.join(' ');
  }

  const title = normalizeLabel(element.getAttribute('title'));
  if (title !== '') return title;

  const placeholder = normalizeLabel(element.getAttribute('placeholder'));
  if (placeholder !== '') return placeholder;

  const id = element.getAttribute('id');
  if (id !== null && id !== '') {
    const label = ownerDocument.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (label !== null) return normalizeLabel(label.textContent);
  }

  return '';
}

/**
 * Names an element the way a selector would: its tag, plus the attributes that
 * a rule could be written against. For the diagnostics only.
 * @param {Element | null} element
 * @returns {string}
 */
function describeShape(element) {
  if (element === null) return '(nothing)';

  const parts = [element.tagName.toLowerCase()];
  for (const name of ['role', 'type', 'aria-expanded', 'aria-selected', 'aria-disabled', 'disabled', 'aria-haspopup', 'value']) {
    const value = element.getAttribute(name);
    if (value !== null) parts.push(`${name}="${value.slice(0, 40)}"`);
  }
  return `<${parts.join(' ')}>`;
}

/**
 * Writes text into a box the way a person would, as far as the page can tell.
 *
 * Setting `element.value` on its own is not enough. Google Photos keeps its own
 * copy of what the box holds, and it only updates that copy when the browser
 * reports a change. The property is therefore set through the prototype setter,
 * which is what the framework listens under, and the two events it waits for are
 * sent by hand.
 * @param {HTMLInputElement | HTMLTextAreaElement} element
 * @param {string} text
 */
function typeIntoField(element, text) {
  element.focus();

  // The content script shares the page's DOM classes, so these globals are the
  // same objects the page's own code sees.
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  if (setter === undefined) element.value = text;
  else setter.call(element, text);

  element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  element.blur();
}

/**
 * @param {Window} view
 * @param {DateEditDialogLabels} labels
 * @param {readonly string[]} locales  Languages to try when reading a date, the page's own first.
 */
export function createDateEditDialog(view, labels, locales) {
  const ownerDocument = view.document;

  /**
   * @param {number} milliseconds
   * @returns {Promise<void>}
   */
  const wait = (milliseconds) => new Promise((resolve) => view.setTimeout(resolve, milliseconds));

  /** @type {import('./dateDialogFields.js').DialogPartLabels} */
  const partLabels = {
    year: labels.yearFieldLabels,
    month: labels.monthFieldLabels,
    day: labels.dayFieldLabels,
    hour: labels.hourFieldLabels,
    minute: labels.minuteFieldLabels,
  };

  /** @returns {Element[]} */
  function findVisibleDialogs() {
    return Array.from(ownerDocument.querySelectorAll(DIALOG_SELECTOR)).filter((dialog) => isVisible(view, dialog));
  }

  /**
   * The dialog on top. Google Photos can leave an earlier one in the DOM, and
   * the last match is the one drawn over everything else.
   * @returns {Element | null}
   */
  function findDialog() {
    const dialogs = findVisibleDialogs();
    return dialogs[dialogs.length - 1] ?? null;
  }

  /**
   * @param {Element} dialog
   * @returns {{ fields: DialogField[], elements: (HTMLInputElement | HTMLTextAreaElement)[] }}
   */
  function collectFields(dialog) {
    /** @type {DialogField[]} */
    const fields = [];
    /** @type {(HTMLInputElement | HTMLTextAreaElement)[]} */
    const elements = [];

    for (const element of dialog.querySelectorAll(FIELD_SELECTOR)) {
      if (!isVisible(view, element)) continue;
      const box = /** @type {HTMLInputElement | HTMLTextAreaElement} */ (element);
      if (box.disabled || box.readOnly) continue;

      fields.push({
        name: readFieldName(ownerDocument, box),
        type: normalizeLabel(box.getAttribute('type')),
        value: box.value,
      });
      elements.push(box);
    }

    return { fields, elements };
  }

  /**
   * The timezone chooser, or null when the dialog shows none.
   *
   * It is an ARIA combobox, not a `select`: a trigger that renders only the
   * chosen option until it is clicked open. The five number boxes carry the same
   * role, so the name is what tells them apart, and an offset in its own text is
   * the fallback for a language whose word for "time zone" is not in the settings.
   * @param {Element} dialog
   * @returns {HTMLElement | null}
   */
  function findTimeZoneChooser(dialog) {
    const choosers = Array.from(dialog.querySelectorAll(CHOOSER_SELECTOR)).filter((chooser) => isVisible(view, chooser));

    const named = choosers.filter((chooser) =>
      matchesAnyLabel(readFieldName(ownerDocument, chooser), labels.timeZoneFieldLabels),
    );
    if (named.length === 1) return /** @type {HTMLElement} */ (named[0]);

    const byOffset = choosers.filter((chooser) => parseGmtOffsetMinutes(chooser.textContent) !== null);
    return byOffset.length === 1 ? /** @type {HTMLElement} */ (byOffset[0]) : null;
  }

  /**
   * The offset the chooser shows right now.
   *
   * Read from the option marked selected, which exists in both states: while the
   * list is shut, it is the only option rendered at all.
   * @param {Element} dialog
   * @returns {DialogTimeZone | null}
   */
  function readTimeZone(dialog) {
    const chooser = findTimeZoneChooser(dialog);
    if (chooser === null) return null;

    const source = chooseZoneText({
      selectedOptionText: dialog.querySelector(SELECTED_OPTION_SELECTOR)?.textContent ?? null,
      chooserText: chooser.textContent,
      expanded: chooser.getAttribute('aria-expanded') === 'true',
    });
    if (source === null) return null;

    const text = normalizeLabel(source).slice(0, MAX_ZONE_NAME_LENGTH);
    return text === '' ? null : { text, offsetMinutes: parseGmtOffsetMinutes(text) };
  }

  /**
   * An option on screen sitting at the offset we want.
   *
   * Searched across the whole document, not the dialog: an opened list is often
   * drawn outside the dialog it belongs to. Options are matched by the offset in
   * their own label, so nothing else on the page can qualify.
   * @param {number} targetOffsetMinutes
   * @returns {HTMLElement | null}
   */
  function findOptionAtOffset(targetOffsetMinutes) {
    const options = Array.from(ownerDocument.querySelectorAll(OPTION_SELECTOR)).filter((option) => isVisible(view, option));
    const index = chooseTimeZoneOptionIndex(
      options.map((option) => option.textContent ?? ''),
      targetOffsetMinutes,
    );
    return index === null ? null : /** @type {HTMLElement} */ (options[index]);
  }

  /**
   * Shuts the chooser's list if it is open, whatever happened while it was.
   * @returns {Promise<void>}
   */
  async function closeChooserList() {
    const chooser = findTimeZoneChooser(findDialog() ?? ownerDocument.body);
    if (chooser === null || chooser.getAttribute('aria-expanded') !== 'true') return;

    chooser.click();
    await waitUntil(
      () => findTimeZoneChooser(findDialog() ?? ownerDocument.body)?.getAttribute('aria-expanded') !== 'true',
      CHOOSER_SETTLE_MS,
    );
  }

  /**
   * @param {() => boolean} isReady
   * @param {number} timeoutMs
   * @returns {Promise<boolean>}
   */
  async function waitUntil(isReady, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (isReady()) return true;
      await wait(CHOOSER_POLL_MS);
    }
    return isReady();
  }

  /**
   * @param {Element} dialog
   * @param {readonly string[]} names
   * @returns {HTMLElement | null}
   */
  function findDialogButton(dialog, names) {
    for (const control of dialog.querySelectorAll(CONTROL_SELECTOR)) {
      if (!isVisible(view, control)) continue;
      if (matchesAnyLabel(readControlName(control), names)) return /** @type {HTMLElement} */ (control);
    }
    return null;
  }

  const dialogApi = {
    /** @returns {boolean} True while any dialog covers the page. */
    isAnyDialogOpen() {
      return findVisibleDialogs().length > 0;
    },

    /**
     * True while a dialog is open that holds the five boxes we know how to fill.
     *
     * This is stricter than `isAnyDialogOpen` on purpose: a "delete this photo?"
     * dialog is also a dialog, and the run must never type into it.
     * @returns {boolean}
     */
    isEditDialogOpen() {
      return dialogApi.read() !== null;
    },

    /**
     * The control that opens the dialog. It lives in the info panel, so the info
     * panel has to be open for this to find anything.
     *
     * That control is usually the panel's date row, whose name is the photo's
     * own timestamp rather than a fixed word. `dateEditControl.js` holds the
     * rule; this only collects the names and clicks the answer.
     * @param {import('./dateTimeParts.js').DateTimeParts | null} [expected] The timestamp the list says this photo has.
     * @returns {HTMLElement | null}
     */
    findEditControl(expected = null) {
      /** @type {HTMLElement[]} */
      const controls = [];
      /** @type {string[]} */
      const names = [];

      for (const control of ownerDocument.querySelectorAll(CONTROL_SELECTOR)) {
        if (!isVisible(view, control)) continue;
        const name = readControlName(control);
        if (name === '') continue;
        controls.push(/** @type {HTMLElement} */ (control));
        names.push(name);
      }

      const index = chooseEditControlIndex(names, labels.editDateLabels, expected, locales);
      return index === null ? null : /** @type {HTMLElement} */ (controls[index]);
    },

    /**
     * Every control whose name is shaped like a timestamp, for the report. This
     * is what to read when a run cannot find the date row.
     * @returns {string[]}
     */
    describeTimestampControls() {
      /** @type {string[]} */
      const names = [];
      for (const control of ownerDocument.querySelectorAll(CONTROL_SELECTOR)) {
        if (!isVisible(view, control)) continue;
        const name = readControlName(control);
        if (looksLikeTimestampName(name)) names.push(name);
      }
      return names;
    },

    /**
     * @param {import('./dateTimeParts.js').DateTimeParts | null} [expected]
     * @returns {boolean} False when the info panel shows no such control.
     */
    open(expected = null) {
      const control = dialogApi.findEditControl(expected);
      if (control === null) return false;
      control.click();
      return true;
    },

    /**
     * Everything on the page that could be the date editor, whatever shape it
     * turned out to have.
     *
     * This exists because the extension can only report what it already knows how
     * to look for, and that is exactly the wrong tool when the thing it looks for
     * is not there. So this ignores every rule the rest of the file follows: it
     * reads boxes anywhere in the document, hidden and disabled ones too, and it
     * names the overlays that are open. A run captures it whenever it fails to
     * find the dialog, and the answer ends up in the report.
     * @returns {PageSnapshot}
     */
    describePage() {
      const dialogs = findVisibleDialogs();

      /** @type {Set<string>} */
      const overlayRoles = new Set();
      for (const element of ownerDocument.querySelectorAll('[role]')) {
        const role = normalizeLabel(element.getAttribute('role'));
        if (OVERLAY_ROLES.includes(role) && isVisible(view, element)) overlayRoles.add(role);
      }

      /** @type {PageFieldSnapshot[]} */
      const fields = [];
      for (const element of ownerDocument.querySelectorAll('input, textarea, [contenteditable="true"]')) {
        if (fields.length >= MAX_SNAPSHOT_FIELDS) break;
        const box = /** @type {HTMLInputElement} */ (element);
        fields.push({
          tag: element.tagName.toLowerCase(),
          type: normalizeLabel(element.getAttribute('type')),
          name: readFieldName(ownerDocument, element),
          value: (box.value ?? element.textContent ?? '').slice(0, MAX_SNAPSHOT_TEXT_LENGTH),
          visible: isVisible(view, element),
          disabled: box.disabled === true,
          readOnly: box.readOnly === true,
          inDialog: dialogs.some((dialog) => dialog.contains(element)),
        });
      }

      /** @type {string[]} */
      const dialogButtonNames = [];
      for (const dialog of dialogs) {
        for (const control of dialog.querySelectorAll(CONTROL_SELECTOR)) {
          const name = readControlName(control);
          if (name === '') continue;
          // Whether it can be pressed matters as much as its name: a Save that is
          // there but disabled looks exactly like a Save that was never clicked.
          const off = control.getAttribute('aria-disabled') === 'true' || control.hasAttribute('disabled');
          const entry = `${name}${off ? ' (disabled)' : ''} ${describeShape(control)}`;
          if (!dialogButtonNames.includes(entry)) dialogButtonNames.push(entry);
        }
      }

      /** @type {string[]} */
      const dialogChoosers = [];
      for (const dialog of dialogs) {
        // Every `select`, whatever its state. A styled one is often invisible with
        // its own markup drawn on top, so visibility is deliberately not checked.
        for (const chooser of dialog.querySelectorAll('select')) {
          const name = readFieldName(ownerDocument, chooser) || '(no name)';
          const selected = normalizeLabel(chooser.options[chooser.selectedIndex]?.textContent);
          dialogChoosers.push(`select "${name}" = ${selected} (${chooser.options.length} options)`);
        }
      }

      /** @type {string[]} */
      const dialogRoles = [];
      for (const dialog of dialogs) {
        for (const element of dialog.querySelectorAll('[role]')) {
          if (dialogRoles.length >= MAX_SNAPSHOT_ROLES) break;
          const role = normalizeLabel(element.getAttribute('role'));
          const name = readFieldName(ownerDocument, element) || normalizeLabel(element.textContent).slice(0, 60);
          const expanded = element.getAttribute('aria-expanded');
          const selected = element.getAttribute('aria-selected');
          dialogRoles.push(
            `${role} "${name}"${expanded === null ? '' : ` expanded=${expanded}`}${selected === null ? '' : ` selected=${selected}`}`,
          );
        }
      }

      // The chooser announces itself: whatever element carries the current zone
      // has a GMT offset in its own text, and so does every option. This says
      // what those elements are and what contains them, which is the one thing
      // needed to drive a dropdown that is not a plain `select`.
      /** @type {string[]} */
      const dialogOffsetTexts = [];
      for (const dialog of dialogs) {
        for (const element of dialog.querySelectorAll('*')) {
          if (dialogOffsetTexts.length >= MAX_SNAPSHOT_OFFSET_TEXTS) break;
          if (element.childElementCount > 0) continue;

          const text = normalizeLabel(element.textContent);
          if (text === '' || text.length > 80 || parseGmtOffsetMinutes(text) === null) continue;

          dialogOffsetTexts.push(`${describeShape(element)} in ${describeShape(element.parentElement)}: ${text}`);
        }
      }

      return {
        dialogCount: dialogs.length,
        dialogOffsetTexts,
        dialogTexts: dialogs.map((dialog) => normalizeLabel(dialog.textContent).slice(0, MAX_SNAPSHOT_TEXT_LENGTH)),
        dialogButtonNames,
        dialogChoosers,
        dialogRoles,
        overlayRoles: [...overlayRoles],
        fields,
      };
    },

    /**
     * Every box the open dialog shows, for the report. Null when no dialog is open.
     * @returns {DialogField[] | null}
     */
    describeFields() {
      const dialog = findDialog();
      return dialog === null ? null : collectFields(dialog).fields;
    },

    /**
     * What the five boxes hold, and which box is which.
     *
     * Null whenever the dialog is missing, or holds boxes this extension cannot
     * tell apart. The caller treats that as "cannot tell yet" and never types.
     * @returns {{ reading: DialogPartValues, parts: DialogPartIndexes, timeZone: DialogTimeZone | null } | null}
     */
    read() {
      const dialog = findDialog();
      if (dialog === null) return null;

      const { fields } = collectFields(dialog);
      const parts = classifyDialogFields(fields, partLabels);
      if (parts === null) return null;

      return { reading: readDialogParts(fields, parts), parts, timeZone: readTimeZone(dialog) };
    },

    /**
     * Types the five numbers and checks that every box kept what it was given.
     *
     * The check is not a formality. Google Photos rejects a value it cannot
     * parse by quietly putting the old one back, and pressing Save then would
     * confirm a change that never happened, or worse, a half-applied one where
     * the day moved and the hour did not.
     * The boxes are found again here rather than taken from the caller. Changing
     * the timezone redraws the dialog, so an index read before that is not safe
     * to type into afterwards.
     * @param {DialogPartValues} values
     * @returns {boolean}
     */
    write(values) {
      const dialog = findDialog();
      if (dialog === null) return false;

      const { fields, elements } = collectFields(dialog);
      const parts = classifyDialogFields(fields, partLabels);
      if (parts === null) return false;

      const boxes = DATE_TIME_PART_NAMES.map((part) => elements[parts[part]]);
      if (boxes.some((box) => box === undefined)) return false;

      for (const [position, part] of DATE_TIME_PART_NAMES.entries()) {
        typeIntoField(/** @type {HTMLInputElement} */ (boxes[position]), values[part]);
      }

      return DATE_TIME_PART_NAMES.every(
        (part, position) => /** @type {HTMLInputElement} */ (boxes[position]).value === values[part],
      );
    },

    /**
     * Moves the timezone chooser to an option at the offset we want.
     *
     * The chooser renders only its chosen option until it is opened, so this has
     * to click it, wait for the list, and click an entry. Every step is checked
     * by reading the page back, never by assuming the click landed.
     *
     * Any option at the right offset will do. Several places share an offset, and
     * which of them is picked does not change the moment the photo gets.
     * @param {number} targetOffsetMinutes
     * @returns {Promise<boolean>}
     */
    async setTimeZone(targetOffsetMinutes) {
      const dialog = findDialog();
      if (dialog === null) return false;
      if (readTimeZone(dialog)?.offsetMinutes === targetOffsetMinutes) return true;

      const chooser = findTimeZoneChooser(dialog);
      if (chooser === null) return false;

      chooser.click();
      const opened = await waitUntil(() => findOptionAtOffset(targetOffsetMinutes) !== null, CHOOSER_OPEN_MS);
      if (opened) /** @type {HTMLElement} */ (findOptionAtOffset(targetOffsetMinutes)).click();

      const chosen =
        opened &&
        (await waitUntil(() => readTimeZone(findDialog() ?? dialog)?.offsetMinutes === targetOffsetMinutes, CHOOSER_SETTLE_MS));

      // However this ended, the list must not be left open. One still on screen
      // covers the rest of the dialog, Save included, and would turn a failure
      // here into a failure on the next photo too.
      await closeChooserList();
      return chosen;
    },

    /** @returns {boolean} False when the dialog shows no button we can name. */
    save() {
      const dialog = findDialog();
      if (dialog === null) return false;

      const button = findDialogButton(dialog, labels.saveLabels);
      if (button === null) return false;
      if (button.getAttribute('aria-disabled') === 'true' || button.hasAttribute('disabled')) return false;

      button.click();
      return true;
    },

    /**
     * Throws away whatever is typed and closes the dialog.
     *
     * Cancel first, Escape second. Escape alone is enough in most builds, but a
     * dialog that ignores it would be left open, and that breaks the rest of the
     * run.
     */
    cancel() {
      const dialog = findDialog();
      if (dialog !== null) findDialogButton(dialog, labels.cancelLabels)?.click();

      for (const type of ['keydown', 'keyup']) {
        const event = new KeyboardEvent(type, { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true, composed: true });
        Object.defineProperty(event, 'keyCode', { get: () => 27 });
        Object.defineProperty(event, 'which', { get: () => 27 });
        (ownerDocument.activeElement ?? ownerDocument.body ?? ownerDocument).dispatchEvent(event);
      }
    },
  };

  return dialogApi;
}

/** @typedef {ReturnType<typeof createDateEditDialog>} DateEditDialog */
