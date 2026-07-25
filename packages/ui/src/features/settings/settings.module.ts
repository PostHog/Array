import {
  SETTINGS_BACKUP_SETTINGS_STORE,
  SETTINGS_BACKUP_THEME_STORE,
} from "@posthog/core/settings/settingsBackup";
import { CONTRIBUTION } from "@posthog/di/contribution";
import {
  settingsBackupSettingsStore,
  settingsBackupThemeStore,
} from "@posthog/ui/features/settings/settingsBackup";
import { ContainerModule } from "inversify";
import { CustomInstructionsSyncContribution } from "./customInstructionsSync.contribution";

export const settingsUiModule = new ContainerModule(({ bind }) => {
  bind(CONTRIBUTION).to(CustomInstructionsSyncContribution).inSingletonScope();
  bind(SETTINGS_BACKUP_SETTINGS_STORE).toConstantValue(
    settingsBackupSettingsStore,
  );
  bind(SETTINGS_BACKUP_THEME_STORE).toConstantValue(settingsBackupThemeStore);
});
