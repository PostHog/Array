import type {
  SettingsBackupSettingsStore,
  SettingsBackupState,
  SettingsBackupThemeStore,
} from "@posthog/core/settings/settingsBackup";
import { useSettingsStore } from "@posthog/ui/features/settings/settingsStore";
import { useThemeStore } from "@posthog/ui/shell/themeStore";

export const settingsBackupSettingsStore: SettingsBackupSettingsStore = {
  getState: () => useSettingsStore.getState() as unknown as SettingsBackupState,
  setState: (patch) => useSettingsStore.setState(patch),
};

export const settingsBackupThemeStore: SettingsBackupThemeStore = {
  getTheme: () => useThemeStore.getState().theme,
  setTheme: (theme) => useThemeStore.getState().setTheme(theme),
};
