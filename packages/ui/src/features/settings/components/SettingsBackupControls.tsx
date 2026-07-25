import { DownloadSimple, UploadSimple } from "@phosphor-icons/react";
import {
  MAX_SETTINGS_BACKUP_ARCHIVE_BYTES,
  type ParsedSettingsBackup,
  SETTINGS_BACKUP_SERVICE,
  type SettingsBackupCategory,
} from "@posthog/core/settings/settingsBackup";
import type { SettingsBackupService } from "@posthog/core/settings/settingsBackupService";
import { useService } from "@posthog/di/react";
import { toast } from "@posthog/ui/primitives/toast";
import { Button, Checkbox, Dialog, Flex, Text } from "@radix-ui/themes";
import { useRef, useState } from "react";

const SETTINGS_BACKUP_CATEGORIES: ReadonlyArray<{
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

export function SettingsBackupControls() {
  const settingsBackup = useService<SettingsBackupService>(
    SETTINGS_BACKUP_SERVICE,
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const [backup, setBackup] = useState<ParsedSettingsBackup | null>(null);
  const [selected, setSelected] = useState<Set<SettingsBackupCategory>>(
    new Set(),
  );

  const exportSettings = () => {
    try {
      const bytes = settingsBackup.exportArchive();
      const blob = new Blob([bytes as BlobPart], { type: "application/zip" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `posthog-code-settings-${new Date().toISOString().slice(0, 10)}.posthog-code-settings`;
      anchor.click();
      URL.revokeObjectURL(url);
      toast.success("Settings exported");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not export settings",
      );
    }
  };

  const inspectFile = async (file: File) => {
    try {
      if (file.size > MAX_SETTINGS_BACKUP_ARCHIVE_BYTES) {
        throw new Error("Settings archive is too large");
      }
      const inspected = settingsBackup.inspectArchive(
        new Uint8Array(await file.arrayBuffer()),
      );
      setBackup(inspected);
      setSelected(new Set(settingsBackup.changedCategories(inspected)));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not read settings archive",
      );
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const importSettings = () => {
    if (!backup || selected.size === 0) return;
    try {
      settingsBackup.applyBackup(backup, selected);
      setBackup(null);
      toast.success("Settings imported");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not import settings",
      );
    }
  };

  return (
    <>
      <Flex gap="2">
        <Button size="1" variant="outline" onClick={exportSettings}>
          <DownloadSimple /> Export
        </Button>
        <Button
          size="1"
          variant="outline"
          onClick={() => inputRef.current?.click()}
        >
          <UploadSimple /> Import
        </Button>
      </Flex>
      <input
        ref={inputRef}
        type="file"
        accept=".posthog-code-settings"
        className="hidden"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) void inspectFile(file);
        }}
      />
      <Dialog.Root
        open={backup !== null}
        onOpenChange={(open) => !open && setBackup(null)}
      >
        <Dialog.Content maxWidth="480px">
          <Dialog.Title>Import settings</Dialog.Title>
          <Dialog.Description>
            Choose which settings to import. Existing credentials, sessions, and
            repository history are never changed.
          </Dialog.Description>
          <Flex direction="column" gap="3" my="4">
            {SETTINGS_BACKUP_CATEGORIES.map(({ id, label }) => {
              const available = backup?.manifest.categories[id] !== undefined;
              return (
                <Text
                  as="label"
                  key={id}
                  size="2"
                  color={available ? undefined : "gray"}
                >
                  <Flex gap="2" align="center">
                    <Checkbox
                      checked={selected.has(id)}
                      disabled={!available}
                      onCheckedChange={(checked) => {
                        setSelected((current) => {
                          const next = new Set(current);
                          if (checked) next.add(id);
                          else next.delete(id);
                          return next;
                        });
                      }}
                    />
                    {label}
                  </Flex>
                </Text>
              );
            })}
          </Flex>
          <Flex justify="end" gap="2">
            <Dialog.Close>
              <Button variant="soft" color="gray">
                Cancel
              </Button>
            </Dialog.Close>
            <Button disabled={selected.size === 0} onClick={importSettings}>
              Import selected
            </Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>
    </>
  );
}
