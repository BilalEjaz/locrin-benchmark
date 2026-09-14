import {
  MarkdownView,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  TFolder,
  moment,
  normalizePath,
  type App
} from "obsidian";
import { resolveLanguage, translate, type UiLanguage } from "./i18n";
import { HUB_ENTRIES_HEADING, insertHubEntry } from "./hub-text";
import { FollowUpIndex } from "./indexer";
import { recurrenceMarker } from "./recurrence";
import { SourceWriter } from "./source-writer";
import type {
  CalendarDensity,
  FollowUpCalendarSettings,
  LanguagePreference,
  NewFollowUp,
  WeekStart
} from "./types";
import { FollowUpRenderChild, GuideModal, ScheduleModal } from "./views";

const DEFAULT_SETTINGS: FollowUpCalendarSettings = {
  hubPath: "_CALENDAR.md",
  weekStart: "monday",
  showCompleted: false,
  calendarDensity: "compact",
  language: "auto"
};

const HUB_TEMPLATE = `---
follow_up_calendar_hub: true
cssclasses: [follow-up-calendar-hub]
---

\`\`\`follow-up-calendar
\`\`\`

\`\`\`follow-up-list
\`\`\`

${HUB_ENTRIES_HEADING}
`;

export default class FollowUpCalendarPlugin extends Plugin {
  settings: FollowUpCalendarSettings = DEFAULT_SETTINGS;
  private index!: FollowUpIndex;
  private writer!: SourceWriter;
  private openingHub: Promise<void> | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.index = new FollowUpIndex(this.app);
    this.writer = new SourceWriter(
      this.app,
      (file) => this.index.reindexFile(file),
      () => this.language
    );

    this.addRibbonIcon("calendar-check-2", translate(this.language, "calendarTitle"), () => {
      void this.openHub();
    }).addClass("follow-up-calendar-ribbon");

    this.addCommand({
      id: "open-follow-up-calendar",
      name: translate(this.language, "openCommand"),
      callback: () => void this.openHub()
    });

    this.addCommand({
      id: "open-tag-calendar-guide",
      name: translate(this.language, "openGuideCommand"),
      callback: () => this.openGuide()
    });

    this.registerMarkdownCodeBlockProcessor("follow-up-calendar", (source, element, context) => {
      context.addChild(
        new FollowUpRenderChild(
          element,
          this.app,
          "calendar",
          source,
          this.index,
          this.writer,
          () => this.settings,
          () => this.language,
          () => this.openScheduleModal(),
          () => this.openGuide()
        )
      );
    });

    this.registerMarkdownCodeBlockProcessor("follow-up-list", (source, element, context) => {
      context.addChild(
        new FollowUpRenderChild(
          element,
          this.app,
          "list",
          source,
          this.index,
          this.writer,
          () => this.settings,
          () => this.language,
          () => this.openScheduleModal(),
          () => this.openGuide()
        )
      );
    });

    this.registerEvent(
      this.app.vault.on("create", (file) => {
        if (file instanceof TFile && file.extension === "md") this.index.schedule(file);
      })
    );
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile && file.extension === "md") this.index.schedule(file);
      })
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (file instanceof TFile && file.extension === "md") this.index.remove(file.path);
      })
    );
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (file instanceof TFile && file.extension === "md") {
          void this.index.rename(file, oldPath);
        }
      })
    );

    this.addSettingTab(new FollowUpCalendarSettingTab(this.app, this));
    this.app.workspace.onLayoutReady(() => void this.index.scanAll());
  }

  onunload(): void {
    this.index?.dispose();
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.index.refreshViews();
  }

  get language(): UiLanguage {
    return resolveLanguage(this.settings.language, moment.locale());
  }

  async applyHubPath(value: string): Promise<void> {
    try {
      await this.doApplyHubPath(value);
    } catch (error) {
      console.error("[Tag Calendar] Could not update the hub note path.", error);
      new Notice(translate(this.language, "hubPathUpdateFailed"));
    }
  }

  private async doApplyHubPath(value: string): Promise<void> {
    const nextPath = this.normalizeHubPath(value);
    if (!nextPath) {
      new Notice(translate(this.language, "hubPathInvalid"));
      return;
    }

    const currentPath = this.normalizeHubPath(this.settings.hubPath) ?? DEFAULT_SETTINGS.hubPath;
    const source = this.app.vault.getAbstractFileByPath(currentPath);
    const target = this.app.vault.getAbstractFileByPath(nextPath);

    if (target instanceof TFolder) {
      new Notice(translate(this.language, "hubFolderConflict"));
      return;
    }
    if (nextPath !== currentPath && source instanceof TFile && target instanceof TFile) {
      new Notice(translate(this.language, "hubPathConflict"));
      return;
    }

    if (nextPath !== currentPath && source instanceof TFile) {
      await this.ensureParentFolder(nextPath);
      await this.app.fileManager.renameFile(source, nextPath);
      this.settings.hubPath = nextPath;
      await this.saveSettings();
      new Notice(translate(this.language, "hubPathRenamed"));
      return;
    }

    this.settings.hubPath = nextPath;
    await this.saveSettings();
    new Notice(translate(this.language, "hubPathApplied"));
  }

  private async loadSettings(): Promise<void> {
    const loaded = (await this.loadData()) as Partial<FollowUpCalendarSettings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...(loaded ?? {}) };
  }

  private openHub(): Promise<void> {
    if (this.openingHub) return this.openingHub;

    this.openingHub = this.doOpenHub()
      .catch((error) => {
        console.error("[Tag Calendar] Could not open the hub note.", error);
        new Notice(translate(this.language, "hubOpenFailed"));
      })
      .finally(() => {
        this.openingHub = null;
      });
    return this.openingHub;
  }

  private async doOpenHub(): Promise<void> {
    const abstractFile = await this.ensureHubFile();
    if (!abstractFile) return;

    const hubViewState = {
      type: "markdown",
      state: { file: abstractFile.path, mode: "preview", source: false },
      active: true
    };

    const existingLeaf = this.app.workspace
      .getLeavesOfType("markdown")
      .find(
        (leaf) => leaf.view instanceof MarkdownView && leaf.view.file?.path === abstractFile.path
      );

    if (existingLeaf) {
      await existingLeaf.setViewState(hubViewState);
      this.app.workspace.revealLeaf(existingLeaf);
      return;
    }

    await this.app.workspace.getLeaf("tab").setViewState(hubViewState);
  }

  private openScheduleModal(): void {
    new ScheduleModal(this.app, this.language, (value) => this.addFollowUp(value)).open();
  }

  openGuide(): void {
    new GuideModal(this.app, this.language, this.manifest.version).open();
  }

  private async addFollowUp(value: NewFollowUp): Promise<boolean> {
    try {
      const hub = await this.ensureHubFile();
      if (!hub) return false;

      const marker = value.recurrence ? recurrenceMarker(value.recurrence, value.date) : null;
      if (value.recurrence && !marker) {
        new Notice(translate(this.language, "invalidSchedule"));
        return false;
      }

      const title = value.title.replace(/[\r\n]+/gu, " ").trim();
      const tag = value.projectTag ? ` #${value.projectTag}` : "";
      const line = `- [ ] ${title} 📅 ${value.date}${marker ? ` ${marker}` : ""} #follow-up${tag}`;
      await this.app.vault.process(hub, (content) => insertHubEntry(content, line));
      await this.index.reindexFile(hub);
      new Notice(translate(this.language, "scheduleAdded"));
      return true;
    } catch (error) {
      console.error("[Tag Calendar] Could not add a follow-up.", error);
      new Notice(translate(this.language, "scheduleAddFailed"));
      return false;
    }
  }

  private async ensureHubFile(): Promise<TFile | null> {
    const path = this.normalizeHubPath(this.settings.hubPath) ?? DEFAULT_SETTINGS.hubPath;
    let abstractFile = this.app.vault.getAbstractFileByPath(path);
    if (abstractFile instanceof TFolder) {
      new Notice(translate(this.language, "hubFolderConflict"));
      return null;
    }

    if (!abstractFile) {
      await this.ensureParentFolder(path);
      abstractFile = await this.app.vault.create(path, HUB_TEMPLATE);
    }
    return abstractFile instanceof TFile ? abstractFile : null;
  }

  private normalizeHubPath(value: string): string | null {
    const raw = value.trim().replace(/\\/gu, "/");
    if (
      !raw ||
      raw.startsWith("/") ||
      /^[a-z]:/iu.test(raw) ||
      raw.split("/").some((part) => part === "..") ||
      raw.toLowerCase().startsWith(".obsidian/")
    ) {
      return null;
    }

    let path = normalizePath(raw);
    if (!path.toLowerCase().endsWith(".md")) path += ".md";
    return path;
  }

  private async ensureParentFolder(path: string): Promise<void> {
    const parts = path.split("/");
    parts.pop();
    let current = "";

    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      const existing = this.app.vault.getAbstractFileByPath(current);
      if (existing instanceof TFile) throw new Error(`${current} is a file.`);
      if (!existing) await this.app.vault.createFolder(current);
    }
  }
}

class FollowUpCalendarSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: FollowUpCalendarPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    const language = this.plugin.language;
    containerEl.empty();
    new Setting(containerEl).setName("Tag Calendar").setHeading();

    new Setting(containerEl)
      .setName(translate(language, "guideSetting"))
      .setDesc(
        `${translate(language, "guideSettingDesc")} ${translate(language, "currentVersion")}: v${this.plugin.manifest.version}`
      )
      .addButton((button) =>
        button
          .setButtonText(translate(language, "openGuide"))
          .setCta()
          .onClick(() => this.plugin.openGuide())
      );

    new Setting(containerEl)
      .setName(translate(language, "language"))
      .setDesc(translate(language, "languageDesc"))
      .addDropdown((dropdown) =>
        dropdown
          .addOption("auto", translate(language, "automatic"))
          .addOption("ko", translate(language, "korean"))
          .addOption("en", translate(language, "english"))
          .setValue(this.plugin.settings.language)
          .onChange(async (value) => {
            this.plugin.settings.language = value as LanguagePreference;
            await this.plugin.saveSettings();
            this.display();
          })
      );

    let pendingHubPath = this.plugin.settings.hubPath;
    new Setting(containerEl)
      .setName(translate(language, "hubPath"))
      .setDesc(translate(language, "hubPathDesc"))
      .addText((text) => {
        text
          .setPlaceholder(DEFAULT_SETTINGS.hubPath)
          .setValue(pendingHubPath)
          .onChange((value) => {
            pendingHubPath = value;
          });
        text.inputEl.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            void this.plugin.applyHubPath(pendingHubPath).then(() => this.display());
          }
        });
      })
      .addButton((button) =>
        button.setButtonText(translate(language, "apply")).onClick(async () => {
          await this.plugin.applyHubPath(pendingHubPath);
          this.display();
        })
      );

    new Setting(containerEl)
      .setName(translate(language, "weekStart"))
      .setDesc(translate(language, "weekStartDesc"))
      .addDropdown((dropdown) =>
        dropdown
          .addOption("monday", translate(language, "monday"))
          .addOption("sunday", translate(language, "sunday"))
          .setValue(this.plugin.settings.weekStart)
          .onChange(async (value) => {
            this.plugin.settings.weekStart = value as WeekStart;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(translate(language, "calendarSize"))
      .setDesc(translate(language, "calendarSizeDesc"))
      .addDropdown((dropdown) =>
        dropdown
          .addOption("compact", translate(language, "compact"))
          .addOption("expanded", translate(language, "expanded"))
          .setValue(this.plugin.settings.calendarDensity)
          .onChange(async (value) => {
            this.plugin.settings.calendarDensity = value as CalendarDensity;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(translate(language, "showCompletedDefault"))
      .setDesc(translate(language, "showCompletedDefaultDesc"))
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.showCompleted).onChange(async (value) => {
          this.plugin.settings.showCompleted = value;
          await this.plugin.saveSettings();
        })
      );
  }
}
