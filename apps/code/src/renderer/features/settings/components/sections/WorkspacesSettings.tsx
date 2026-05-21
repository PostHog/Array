import { FolderPicker } from "@features/folder-picker/components/FolderPicker";
import { SettingRow } from "@features/settings/components/SettingRow";
import { Flex } from "@radix-ui/themes";
import { trpcClient, useTRPC } from "@renderer/trpc";
import { useQuery } from "@tanstack/react-query";
import { logger } from "@utils/logger";
import { useEffect, useState } from "react";

const log = logger.scope("workspaces-settings");

export function WorkspacesSettings() {
  const trpc = useTRPC();
  const [localWorktreeLocation, setLocalWorktreeLocation] =
    useState<string>("");

  const { data: worktreeLocation } = useQuery(
    trpc.secureStore.getItem.queryOptions(
      { key: "worktreeLocation" },
      { select: (result) => result ?? null },
    ),
  );

  useEffect(() => {
    if (worktreeLocation) {
      setLocalWorktreeLocation(worktreeLocation);
    }
  }, [worktreeLocation]);

  const handleWorktreeLocationChange = async (newLocation: string) => {
    setLocalWorktreeLocation(newLocation);
    try {
      await trpcClient.secureStore.setItem.query({
        key: "worktreeLocation",
        value: newLocation,
      });
    } catch (error) {
      log.error("Failed to set worktree location:", error);
    }
  };

  return (
    <Flex direction="column">
      <SettingRow
        label="Workspace location"
        description="Directory where isolated workspaces are created for each task"
        noBorder
      >
        <div className="min-w-[200px]">
          <FolderPicker
            value={localWorktreeLocation}
            onChange={handleWorktreeLocationChange}
            placeholder="~/.posthog-code"
          />
        </div>
      </SettingRow>
    </Flex>
  );
}
