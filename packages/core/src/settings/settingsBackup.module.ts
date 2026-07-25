import { SETTINGS_BACKUP_SERVICE } from "@posthog/core/settings/settingsBackup";
import { SettingsBackupService } from "@posthog/core/settings/settingsBackupService";
import { ContainerModule } from "inversify";

export const settingsBackupCoreModule = new ContainerModule(({ bind }) => {
  bind(SETTINGS_BACKUP_SERVICE).to(SettingsBackupService).inSingletonScope();
});
