import {
  createSettingsBackup,
  type ParsedSettingsBackup,
  parseSettingsBackup,
  type SettingsBackupCategory,
} from "@posthog/core/settings/settingsBackup";
import {
  type CustomSound,
  useSettingsStore,
} from "@posthog/ui/features/settings/settingsStore";
import { useThemeStore } from "@posthog/ui/shell/themeStore";

export const SETTINGS_BACKUP_CATEGORIES: ReadonlyArray<{
  id: SettingsBackupCategory;
  label: string;
}> = [
  { id: "notifications", label: "Notifications and sounds" },
  { id: "agentDefaults", label: "Agent defaults" },
  { id: "composer", label: "Composer and conversation" },
  { id: "terminal", label: "Terminal" },
  { id: "system", label: "System and updates" },
  { id: "appearance", label: "Appearance and experiments" },
  { id: "onboarding", label: "Onboarding and dismissed hints" },
];

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
    "allowBypassPermissions",
    "preventSleepWhileRunning",
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

type SettingsState = ReturnType<typeof useSettingsStore.getState>;

function pick(
  state: SettingsState,
  fields: readonly string[],
): Record<string, unknown> {
  return Object.fromEntries(
    fields.map((field) => [field, state[field as keyof SettingsState]]),
  );
}

export function exportSettingsArchive(): Uint8Array {
  const state = useSettingsStore.getState();
  const categories = Object.fromEntries(
    SETTINGS_BACKUP_CATEGORIES.map(({ id }) => [
      id,
      pick(state, CATEGORY_FIELDS[id]),
    ]),
  );
  categories.appearance = {
    ...categories.appearance,
    theme: useThemeStore.getState().theme,
  };
  return createSettingsBackup(categories, state.customSounds);
}

export function inspectSettingsArchive(
  bytes: Uint8Array,
): ParsedSettingsBackup {
  return parseSettingsBackup(bytes);
}

export function changedSettingsCategories(
  backup: ParsedSettingsBackup,
): SettingsBackupCategory[] {
  const state = useSettingsStore.getState();
  return SETTINGS_BACKUP_CATEGORIES.flatMap(({ id }) => {
    const imported = backup.manifest.categories[id];
    if (!imported) return [];
    const current = pick(state, CATEGORY_FIELDS[id]);
    const importedComparable: Record<string, unknown> = { ...imported };
    if (id === "appearance") current.theme = useThemeStore.getState().theme;
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

function compatibleValue(current: unknown, imported: unknown): boolean {
  if (current === null)
    return imported === null || typeof imported === "string";
  if (Array.isArray(current)) return Array.isArray(imported);
  return typeof current === typeof imported;
}

export function applySettingsBackup(
  backup: ParsedSettingsBackup,
  selected: ReadonlySet<SettingsBackupCategory>,
): void {
  const current = useSettingsStore.getState();
  const patch: Partial<SettingsState> = {};
  for (const category of selected) {
    const imported = backup.manifest.categories[category];
    if (!imported) continue;
    const importedRecord = imported as Record<string, unknown>;
    for (const field of CATEGORY_FIELDS[category]) {
      const value = importedRecord[field];
      if (
        value !== undefined &&
        compatibleValue(current[field as keyof SettingsState], value)
      ) {
        (patch as Record<string, unknown>)[field] = value;
      }
    }
    const importedTheme = importedRecord.theme;
    if (category === "appearance" && typeof importedTheme === "string") {
      const allowedThemes = new Set(["light", "dark", "system"]);
      if (allowedThemes.has(importedTheme)) {
        useThemeStore
          .getState()
          .setTheme(importedTheme as "light" | "dark" | "system");
      }
    }
  }
  if (selected.has("notifications")) {
    const importedSounds: CustomSound[] = backup.manifest.sounds.map(
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
  useSettingsStore.setState(patch);
}
