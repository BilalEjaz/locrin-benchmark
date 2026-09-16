import {
  App,
  Component,
  MarkdownRenderChild,
  MarkdownRenderer,
  Modal,
  Notice,
  Setting,
  setIcon
} from "obsidian";
import { buildGuideMarkdown } from "./guide";
import { parseBlockOptions } from "./block-options";
import { FollowUpIndex } from "./indexer";
import { formatLongDate, formatMonth, translate, weekdayLabels, type UiLanguage } from "./i18n";
import { SourceWriter } from "./source-writer";
import {
  sortNearestFirst,
  type CalendarDensity,
  type FollowUpBlockOptions,
  type FollowUpCalendarSettings,
  type FollowUpItem,
  type NewFollowUp,
  type RecurrenceFrequency,
  type WeekStart
} from "./types";

type ViewKind = "calendar" | "list";

function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateKey(dateKey: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function sourceName(item: FollowUpItem): string {
  const name = item.filePath.split("/").pop() ?? item.filePath;
  return name.endsWith(".md") ? name.slice(0, -3) : name;
}

class CopyFallbackModal extends Modal {
  constructor(
    app: App,
    private readonly value: string,
    private readonly language: UiLanguage
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText(translate(this.language, "copyFallbackTitle"));
    const textarea = this.contentEl.createEl("textarea", {
      cls: "follow-up-calendar-copy-fallback"
    });
    textarea.value = this.value;
    textarea.setAttr("readonly", "true");
    textarea.focus();
    textarea.select();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class ScheduleModal extends Modal {
  private title = "";
  private date = formatDateKey(new Date());
  private recurrence: RecurrenceFrequency | undefined;
  private projectTag = "";

  constructor(
    app: App,
    private readonly language: UiLanguage,
    private readonly onSubmit: (value: NewFollowUp) => Promise<boolean>
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("follow-up-calendar-schedule-modal");
    this.titleEl.setText(translate(this.language, "addScheduleTitle"));

    new Setting(this.contentEl)
      .setName(translate(this.language, "title"))
      .addText((text) => {
        text.setPlaceholder(translate(this.language, "titlePlaceholder")).onChange((value) => {
          this.title = value;
        });
        window.setTimeout(() => text.inputEl.focus(), 0);
      });

    new Setting(this.contentEl)
      .setName(translate(this.language, "dueDate"))
      .addText((text) => {
        text.inputEl.type = "date";
        text.setValue(this.date).onChange((value) => {
          this.date = value;
        });
      });

    new Setting(this.contentEl)
      .setName(translate(this.language, "recurrence"))
      .setDesc(translate(this.language, "recurringAdvance"))
      .addDropdown((dropdown) =>
        dropdown
          .addOption("", translate(this.language, "recurrenceNone"))
          .addOption("daily", translate(this.language, "recurrenceDaily"))
          .addOption("weekly", translate(this.language, "recurrenceWeekly"))
          .addOption("monthly", translate(this.language, "recurrenceMonthly"))
          .addOption("yearly", translate(this.language, "recurrenceYearly"))
          .setValue("")
          .onChange((value) => {
            this.recurrence = value ? (value as RecurrenceFrequency) : undefined;
          })
      );

    new Setting(this.contentEl)
      .setName(translate(this.language, "projectTag"))
      .setDesc(translate(this.language, "projectTagDesc"))
      .addText((text) =>
        text.setPlaceholder("sindangseoul").onChange((value) => {
          this.projectTag = value;
        })
      );

    const actions = this.contentEl.createDiv("follow-up-calendar-modal-actions");
    const cancel = actions.createEl("button", {
      text: translate(this.language, "cancel"),
      attr: { type: "button" }
    });
    cancel.addEventListener("click", () => this.close());

    const add = actions.createEl("button", {
      cls: "mod-cta",
      text: translate(this.language, "add"),
      attr: { type: "button" }
    });
    add.addEventListener("click", () => {
      void this.submit(add);
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private async submit(button: HTMLButtonElement): Promise<void> {
    const title = this.title.trim();
    const date = parseDateKey(this.date);
    if (!title || formatDateKey(date) !== this.date) {
      new Notice(translate(this.language, "invalidSchedule"));
      return;
    }

    const projectTag = this.projectTag.trim().replace(/^#/u, "").toLowerCase();
    if (projectTag && !/^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u.test(projectTag)) {
      new Notice(translate(this.language, "invalidProjectTag"));
      return;
    }

    button.disabled = true;
    const success = await this.onSubmit({
      title,
      date: this.date,
      recurrence: this.recurrence,
      projectTag: projectTag || undefined
    });
    button.disabled = false;
    if (success) this.close();
  }
}

class DayItemsModal extends Modal {
  constructor(
    app: App,
    private readonly dateKey: string,
    private readonly items: FollowUpItem[],
    private readonly writer: SourceWriter,
    private readonly language: UiLanguage
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("follow-up-calendar-day-modal");
    this.titleEl.setText(formatLongDate(this.language, parseDateKey(this.dateKey)));
    const rows = this.contentEl.createDiv("follow-up-day-modal-rows");

    for (const item of this.items) {
      const row = rows.createDiv("follow-up-day-modal-item");
      if (item.completed) row.addClass("is-completed");

      const checkbox = row.createEl("input", {
        attr: {
          type: "checkbox",
          "aria-label": `${item.title} ${translate(this.language, "taskStatus")}`
        }
      });
      checkbox.checked = item.completed;
      if (item.recurrence && !item.completed) {
        checkbox.setAttr("title", translate(this.language, "recurringAdvance"));
      }
      checkbox.addEventListener("change", () => {
        const requested = checkbox.checked;
        checkbox.disabled = true;
        void this.writer.setCompleted(item, requested).then((success) => {
          if (success && item.recurrence && requested && !item.completed) {
            this.close();
            return;
          }
          if (!success) checkbox.checked = !requested;
          checkbox.disabled = false;
          row.toggleClass("is-completed", success ? requested : !requested);
        });
      });

      const content = row.createDiv("follow-up-day-modal-content");
      const button = content.createEl("button", {
        cls: "follow-up-calendar-source-button",
        text: item.title,
        attr: { type: "button", title: `${item.filePath}:${item.line + 1}` }
      });
      button.addEventListener("click", () => {
        this.close();
        void this.writer.openSource(item);
      });
      content.createSpan({ cls: "follow-up-list-source", text: sourceName(item) });
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class GuideModal extends Modal {
  private readonly markdownComponent = new Component();

  constructor(
    app: App,
    private readonly language: UiLanguage,
    private readonly version: string
  ) {
    super(app);
  }

  onOpen(): void {
    this.markdownComponent.load();
    this.modalEl.addClass("tag-calendar-guide-modal");
    this.titleEl.setText(`Tag Calendar · ${translate(this.language, "guide")} · v${this.version}`);
    const guide = this.contentEl.createDiv("tag-calendar-guide-content markdown-rendered");
    void MarkdownRenderer.render(
      this.app,
      buildGuideMarkdown(this.language, this.version),
      guide,
      "",
      this.markdownComponent
    );
  }

  onClose(): void {
    this.markdownComponent.unload();
    this.contentEl.empty();
  }
}

export class FollowUpRenderChild extends MarkdownRenderChild {
  private unsubscribe: (() => void) | undefined;
  private readonly options: FollowUpBlockOptions;
  private showCompleted: boolean;
  private density: CalendarDensity;
  private currentMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  constructor(
    containerEl: HTMLElement,
    private readonly app: App,
    private readonly kind: ViewKind,
    source: string,
    private readonly index: FollowUpIndex,
    private readonly writer: SourceWriter,
    private readonly getSettings: () => FollowUpCalendarSettings,
    private readonly getLanguage: () => UiLanguage,
    private readonly addSchedule: () => void,
    private readonly openGuide: () => void
  ) {
    super(containerEl);
    this.options = parseBlockOptions(source);
    this.showCompleted = this.options.showCompleted ?? getSettings().showCompleted;
    this.density = this.options.density ?? getSettings().calendarDensity;
  }

  onload(): void {
    this.unsubscribe = this.index.subscribe(() => this.render());
    this.render();
  }

  onunload(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.containerEl.empty();
  }

  private render(): void {
    this.containerEl.empty();
    this.containerEl.addClass("follow-up-calendar-root");
    if (this.kind === "calendar") this.renderCalendar();
    else this.renderList();
  }

  private visibleItems(): FollowUpItem[] {
    const items = this.index.getItems();
    return this.showCompleted ? items : items.filter((item) => !item.completed);
  }

  private renderCalendar(): void {
    const language = this.getLanguage();
    const settings = this.getSettings();
    const weekStart = this.options.weekStart ?? settings.weekStart;
    const visibleItems = this.visibleItems();
    const wrapper = this.containerEl.createDiv("follow-up-calendar");
    wrapper.addClass(`is-${this.density}`);
    const header = wrapper.createDiv("follow-up-calendar-header");

    const heading = header.createDiv("follow-up-calendar-heading");
    heading.createEl("h3", { text: translate(language, "calendarTitle") });
    heading.createSpan({
      cls: "follow-up-calendar-count",
      text: String(visibleItems.length),
      attr: { title: `${visibleItems.length} ${translate(language, "itemCount")}` }
    });
    this.createActionButton(
      heading,
      this.density === "compact" ? "maximize-2" : "minimize-2",
      this.density === "compact"
        ? translate(language, "expandedView")
        : translate(language, "compactView"),
      () => {
        this.density = this.density === "compact" ? "expanded" : "compact";
        this.render();
      }
    );

    const actions = header.createDiv("follow-up-calendar-actions");
    this.createActionButton(
      actions,
      "calendar-plus",
      translate(language, "addSchedule"),
      this.addSchedule,
      true
    );
    this.createActionButton(
      actions,
      this.showCompleted ? "eye-off" : "eye",
      this.showCompleted ? translate(language, "hideCompleted") : translate(language, "showCompleted"),
      () => {
        this.showCompleted = !this.showCompleted;
        this.render();
      },
      true
    );
    this.createActionButton(
      actions,
      "copy",
      translate(language, "copy"),
      () => void this.copyCalendarBlock(weekStart, language),
      true
    );
    this.createActionButton(
      actions,
      "book-open",
      translate(language, "guide"),
      this.openGuide,
      true
    );

    const navigation = wrapper.createDiv("follow-up-calendar-navigation");
    this.createActionButton(
      navigation,
      "chevron-left",
      translate(language, "previousMonth"),
      () => this.changeMonth(-1)
    );
    navigation.createEl("strong", {
      cls: "follow-up-calendar-month",
      text: formatMonth(language, this.currentMonth)
    });
    this.createActionButton(
      navigation,
      "chevron-right",
      translate(language, "nextMonth"),
      () => this.changeMonth(1)
    );
    this.createButton(
      navigation,
      translate(language, "today"),
      translate(language, "today"),
      () => {
        const now = new Date();
        this.currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        this.render();
      },
      "follow-up-calendar-today"
    );

    const calendarFrame = wrapper.createDiv("follow-up-calendar-frame");
    const weekdays = calendarFrame.createDiv("follow-up-calendar-weekdays");
    for (const [index, label] of weekdayLabels(language, weekStart).entries()) {
      const weekday = weekdays.createDiv({ cls: "follow-up-calendar-weekday", text: label });
      if ((weekStart === "sunday" && index === 0) || (weekStart === "monday" && index === 6)) {
        weekday.addClass("is-sunday");
      }
      if ((weekStart === "sunday" && index === 6) || (weekStart === "monday" && index === 5)) {
        weekday.addClass("is-saturday");
      }
    }

    const grid = calendarFrame.createDiv("follow-up-calendar-grid");
    const year = this.currentMonth.getFullYear();
    const month = this.currentMonth.getMonth();
    const firstWeekday = new Date(year, month, 1).getDay();
    const leadingDays = weekStart === "monday" ? (firstWeekday + 6) % 7 : firstWeekday;
    const firstCell = new Date(year, month, 1 - leadingDays);
    const today = formatDateKey(new Date());
    const byDate = new Map<string, FollowUpItem[]>();

    for (const item of visibleItems) {
      const existing = byDate.get(item.date) ?? [];
      existing.push(item);
      byDate.set(item.date, existing);
    }

    for (let offset = 0; offset < 42; offset += 1) {
      const date = new Date(firstCell.getFullYear(), firstCell.getMonth(), firstCell.getDate() + offset);
      const dateKey = formatDateKey(date);
      const cell = grid.createDiv("follow-up-calendar-day");
      const outsideMonth = date.getMonth() !== month;
      if (outsideMonth) cell.addClass("is-outside-month");
      if (dateKey === today) cell.addClass("is-today");
      if (date.getDay() === 0) cell.addClass("is-sunday");
      if (date.getDay() === 6) cell.addClass("is-saturday");

      const number = cell.createDiv("follow-up-calendar-day-number");
      number.createSpan({ text: String(date.getDate()) });
      if (outsideMonth) continue;

      const dayItems = (byDate.get(dateKey) ?? []).sort((left, right) =>
        left.title.localeCompare(right.title, language === "ko" ? "ko" : "en")
      );
      if (this.density === "compact") {
        this.renderCompactDay(cell, dateKey, date, dayItems, today, language);
        continue;
      }

      const itemContainer = cell.createDiv("follow-up-calendar-day-items");
      for (const item of dayItems.slice(0, 2)) {
        this.renderCalendarItem(itemContainer, item, today, language);
      }

      if (dayItems.length > 2) {
        this.createButton(
          itemContainer,
          `+${dayItems.length - 2} ${translate(language, "more")}`,
          formatLongDate(language, date),
          () => new DayItemsModal(this.app, dateKey, dayItems, this.writer, language).open(),
          "follow-up-calendar-more"
        );
      }
    }
  }

  private renderCompactDay(
    cell: HTMLElement,
    dateKey: string,
    date: Date,
    items: FollowUpItem[],
    today: string,
    language: UiLanguage
  ): void {
    if (items.length === 0) return;

    const label = `${formatLongDate(language, date)} · ${items.length} ${translate(language, "itemCount")}`;
    const button = cell.createEl("button", {
      cls: "follow-up-calendar-compact-trigger",
      attr: {
        type: "button",
        "aria-label": label,
        title: items.map((item) => item.title).join(" · ")
      }
    });
    const dots = button.createSpan("follow-up-calendar-compact-dots");
    for (const item of items.slice(0, 3)) {
      const dot = dots.createSpan("follow-up-calendar-compact-dot");
      if (item.completed) dot.addClass("is-completed");
      if (!item.completed && item.date < today) dot.addClass("is-overdue");
      if (item.recurrence) dot.addClass("is-recurring");
    }
    button.createSpan({ cls: "follow-up-calendar-compact-count", text: String(items.length) });
    button.addEventListener("click", () => {
      new DayItemsModal(this.app, dateKey, items, this.writer, language).open();
    });
  }

  private renderList(): void {
    const language = this.getLanguage();
    const today = formatDateKey(new Date());
    const items = sortNearestFirst(this.visibleItems(), today);
    const wrapper = this.containerEl.createDiv("follow-up-list");
    const header = wrapper.createDiv("follow-up-list-header");
    const heading = header.createDiv("follow-up-list-heading");
    heading.createEl("h3", { text: translate(language, "scheduleList") });
    heading.createSpan({ cls: "follow-up-calendar-count", text: String(items.length) });
    header.createSpan({ cls: "follow-up-list-order", text: translate(language, "nearestFirst") });
    this.createActionButton(
      header,
      this.showCompleted ? "eye-off" : "eye",
      this.showCompleted ? translate(language, "hideCompleted") : translate(language, "showCompleted"),
      () => {
        this.showCompleted = !this.showCompleted;
        this.render();
      },
      true
    );
    this.createActionButton(
      header,
      "book-open",
      translate(language, "guide"),
      this.openGuide
    );

    if (items.length === 0) {
      wrapper.createDiv({ cls: "follow-up-calendar-empty", text: translate(language, "noItems") });
      return;
    }

    const rows = wrapper.createDiv("follow-up-list-rows");
    for (const item of items) this.renderListItem(rows, item, today, language);
  }

  private renderCalendarItem(
    parent: HTMLElement,
    item: FollowUpItem,
    today: string,
    language: UiLanguage
  ): void {
    const row = parent.createDiv("follow-up-calendar-item");
    if (item.completed) row.addClass("is-completed");
    if (item.recurrence) row.addClass("is-recurring");
    if (!item.completed && item.date < today) row.addClass("is-overdue");
    this.addCheckbox(row, item, language);
    this.addRecurrenceBadge(row, item, language);
    this.addSourceButton(row, item, item.title);
  }

  private renderListItem(
    parent: HTMLElement,
    item: FollowUpItem,
    today: string,
    language: UiLanguage
  ): void {
    const row = parent.createDiv("follow-up-list-item");
    if (item.completed) row.addClass("is-completed");
    if (item.recurrence) row.addClass("is-recurring");
    if (!item.completed && item.date < today) row.addClass("is-overdue");

    this.addCheckbox(row, item, language);
    row.createEl("time", {
      cls: "follow-up-list-date",
      text: item.date,
      attr: { datetime: item.date }
    });
    const content = row.createDiv("follow-up-list-content");
    this.addRecurrenceBadge(content, item, language);
    this.addSourceButton(content, item, item.title);
    content.createSpan({ cls: "follow-up-list-source", text: sourceName(item) });
  }

  private addCheckbox(parent: HTMLElement, item: FollowUpItem, language: UiLanguage): void {
    const checkbox = parent.createEl("input", {
      cls: "follow-up-calendar-checkbox",
      attr: {
        type: "checkbox",
        "aria-label": `${item.title} ${translate(language, "taskStatus")}`
      }
    });
    checkbox.checked = item.completed;
    if (item.recurrence && !item.completed) {
      checkbox.setAttr("title", translate(language, "recurringAdvance"));
    }
    checkbox.addEventListener("change", () => {
      const requested = checkbox.checked;
      checkbox.disabled = true;
      void this.writer.setCompleted(item, requested).then((success) => {
        if (checkbox.isConnected) {
          if (!success) checkbox.checked = !requested;
          checkbox.disabled = false;
        }
      });
    });
  }

  private addSourceButton(parent: HTMLElement, item: FollowUpItem, label: string): void {
    const button = parent.createEl("button", {
      cls: "follow-up-calendar-source-button",
      text: label,
      attr: { type: "button", title: `${item.filePath}:${item.line + 1}` }
    });
    button.addEventListener("click", () => void this.writer.openSource(item));
  }

  private addRecurrenceBadge(
    parent: HTMLElement,
    item: FollowUpItem,
    language: UiLanguage
  ): void {
    if (!item.recurrence) return;
    parent.createSpan({
      cls: "follow-up-calendar-recurrence",
      text: "↻",
      attr: { title: translate(language, "recurringAdvance") }
    });
  }

  private createActionButton(
    parent: HTMLElement,
    icon: string,
    label: string,
    action: () => void,
    showLabel = false
  ): HTMLButtonElement {
    const button = parent.createEl("button", {
      cls: showLabel ? "follow-up-calendar-action has-label" : "follow-up-calendar-action",
      attr: { type: "button", "aria-label": label, title: label }
    });
    const iconContainer = button.createSpan("follow-up-calendar-action-icon");
    setIcon(iconContainer, icon);
    if (showLabel) button.createSpan({ cls: "follow-up-calendar-action-label", text: label });
    button.addEventListener("click", action);
    return button;
  }

  private createButton(
    parent: HTMLElement,
    text: string,
    label: string,
    action: () => void,
    className: string
  ): HTMLButtonElement {
    const button = parent.createEl("button", {
      cls: className,
      text,
      attr: { type: "button", "aria-label": label, title: label }
    });
    button.addEventListener("click", action);
    return button;
  }

  private changeMonth(delta: number): void {
    this.currentMonth = new Date(
      this.currentMonth.getFullYear(),
      this.currentMonth.getMonth() + delta,
      1
    );
    this.render();
  }

  private async copyCalendarBlock(weekStart: WeekStart, language: UiLanguage): Promise<void> {
    const value = [
      "```tag-calendar",
      `weekStart: ${weekStart}`,
      `showCompleted: ${this.showCompleted}`,
      `density: ${this.density}`,
      "```"
    ].join("\n");

    try {
      await navigator.clipboard.writeText(value);
      new Notice(translate(language, "copySuccess"));
    } catch {
      new CopyFallbackModal(this.app, value, language).open();
    }
  }
}
