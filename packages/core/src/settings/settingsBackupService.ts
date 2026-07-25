import {
  createSettingsBackup,
  type ExportSound,
  type ParsedSettingsBackup,
  parseSettingsBackup,
  SETTINGS_BACKUP_CATEGORY_IDS,
  SETTINGS_BACKUP_SETTINGS_STORE,
  SETTINGS_BACKUP_THEME_STORE,
  type SettingsBackupCategory,
  type SettingsBackupSettingsStore,
  type SettingsBackupState,
  type SettingsBackupTheme,
  type SettingsBackupThemeStore,
} from "@posthog/core/settings/settingsBackup";
import { inject, injectable } from "inversify";

const CATEGORY_FIELDS: Record<SettingsBackupCategory, readonly string[]> = {
  notifications: [
    "desktopNotifications",
    "dockBadgeNotifications",
    "dockBounceNotifications",
    "toastNotifications",
    "completionSound",
    "completionVolume",
    "scaleSoundWithTaskLength",
  ],
  agentDefaults: [
    "defaultRunMode",
    "defaultInitialTaskMode",
    "defaultReasoningEffort",
    "defaultMessagingMode",
  ],
  composer: [
    "autoConvertLongText",
    "sendMessagesWith",
    "customInstructions",
    "diffOpenMode",
    "conversationCollapseMode",
  ],
  terminal: [
    "terminalFont",
    "terminalCustomFontFamily",
    "terminalGpuRendering",
  ],
  system: [
    "debugLogsCloudRuns",
    "autoPublishCloudRuns",
    "downloadUpdatesAutomatically",
  ],
  appearance: [
    "hedgehogMode",
    "slotMachineMode",
    "brainrotMode",
    "mcpAppsDisabledServers",
    "dismissibleUpdateBanners",
    "useNewChatThread",
  ],
  onboarding: ["lastSeenChangelogVersion", "hints"],
};

function pick(
  state: SettingsBackupState,
  fields: readonly string[],
): Record<string, unknown> {
  return Object.fromEntries(fields.map((field) => [field, state[field]]));
}

function compatibleValue(current: unknown, imported: unknown): boolean {
  if (current === null)
    return imported === null || typeof imported === "string";
  if (Array.isArray(current)) return Array.isArray(imported);
  return typeof current === typeof imported;
}

@injectable()
export class SettingsBackupService {
  constructor(
    @inject(SETTINGS_BACKUP_SETTINGS_STORE)
    private readonly settingsStore: SettingsBackupSettingsStore,
    @inject(SETTINGS_BACKUP_THEME_STORE)
    private readonly themeStore: SettingsBackupThemeStore,
  ) {}

  exportArchive(): Uint8Array {
    const state = this.settingsStore.getState();
    const categories = Object.fromEntries(
      SETTINGS_BACKUP_CATEGORY_IDS.map((id) => [
        id,
        pick(state, CATEGORY_FIELDS[id]),
      ]),
    );
    categories.appearance = {
      ...categories.appearance,
      theme: this.themeStore.getTheme(),
    };
    return createSettingsBackup(categories, state.customSounds);
  }

  inspectArchive(bytes: Uint8Array): ParsedSettingsBackup {
    return parseSettingsBackup(bytes);
  }

  changedCategories(backup: ParsedSettingsBackup): SettingsBackupCategory[] {
    const state = this.settingsStore.getState();
    return SETTINGS_BACKUP_CATEGORY_IDS.flatMap((id) => {
      const imported = backup.manifest.categories[id];
      if (!imported) return [];
      const current = pick(state, CATEGORY_FIELDS[id]);
      const importedComparable: Record<string, unknown> = { ...imported };
      if (id === "appearance") current.theme = this.themeStore.getTheme();
      if (id === "notifications") {
        current.customSounds = state.customSounds.map(
          ({ dataUrl: _dataUrl, ...sound }) => sound,
        );
        importedComparable.customSounds = backup.manifest.sounds.map(
          ({ file: _file, mimeType: _mimeType, ...sound }) => sound,
        );
      }
      return JSON.stringify(current) === JSON.stringify(importedComparable)
        ? []
        : [id];
    });
  }

  applyBackup(
    backup: ParsedSettingsBackup,
    selected: ReadonlySet<SettingsBackupCategory>,
  ): void {
    const current = this.settingsStore.getState();
    const patch: Partial<SettingsBackupState> = {};
    for (const category of selected) {
      const imported = backup.manifest.categories[category];
      if (!imported) continue;
      const importedRecord = imported as Record<string, unknown>;
      for (const field of CATEGORY_FIELDS[category]) {
        const value = importedRecord[field];
        if (value !== undefined && compatibleValue(current[field], value)) {
          patch[field] = value;
        }
      }
      const importedTheme = importedRecord.theme;
      if (
        category === "appearance" &&
        (importedTheme === "light" ||
          importedTheme === "dark" ||
          importedTheme === "system")
      ) {
        this.themeStore.setTheme(importedTheme as SettingsBackupTheme);
      }
    }
    if (selected.has("notifications")) {
      const importedSounds: ExportSound[] = backup.manifest.sounds.map(
        (sound) => ({
          id: sound.id,
          name: sound.name,
          durationMs: sound.durationMs,
          dataUrl: backup.soundDataUrls[sound.id],
        }),
      );
      const importedIds = new Set(importedSounds.map(({ id }) => id));
      patch.customSounds = [
        ...current.customSounds.filter(({ id }) => !importedIds.has(id)),
        ...importedSounds,
      ];
    }
    this.settingsStore.setState(patch);
  }
}
