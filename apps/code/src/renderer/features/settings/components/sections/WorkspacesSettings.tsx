import { FolderPicker } from "@features/folder-picker/components/FolderPicker";
import { SettingRow } from "@features/settings/components/SettingRow";
import { Folder, X } from "@phosphor-icons/react";
import { Button } from "@posthog/quill";
import { trpcClient, useTRPC } from "@renderer/trpc";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { logger } from "@utils/logger";
import { toast } from "@utils/toast";
import { useEffect, useState } from "react";

const log = logger.scope("workspaces-settings");

export function WorkspacesSettings() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
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

  const defaultsQuery = useQuery(
    trpc.additionalDirectories.listDefaults.queryOptions(),
  );
  const defaults = defaultsQuery.data ?? [];

  const invalidateDefaults = () =>
    queryClient.invalidateQueries(
      trpc.additionalDirectories.listDefaults.pathFilter(),
    );

  const addMutation = useMutation(
    trpc.additionalDirectories.addDefault.mutationOptions({
      onSuccess: invalidateDefaults,
    }),
  );
  const removeMutation = useMutation(
    trpc.additionalDirectories.removeDefault.mutationOptions({
      onSuccess: invalidateDefaults,
    }),
  );

  const handleAddDefaultDirectory = async () => {
    try {
      const path = await trpcClient.os.selectDirectory.query();
      if (path) {
        await addMutation.mutateAsync({ path });
      }
    } catch (err) {
      log.error("Failed to add default directory", err);
      toast.error("Failed to open folder picker");
    }
  };

  return (
    <div className="flex flex-col">
      <SettingRow
        label="Workspace location"
        description="Directory where isolated workspaces are created for each task"
      >
        <div className="min-w-[200px]">
          <FolderPicker
            value={localWorktreeLocation}
            onChange={handleWorktreeLocationChange}
            placeholder="~/.posthog-code"
            size="1"
          />
        </div>
      </SettingRow>
      <div className="flex flex-col gap-2 py-4">
        <p className="font-medium text-sm">Default folders for new chats</p>
        <p className="text-(--gray-11) text-[13px]">
          Folders the agent can access in every new chat on your device.
        </p>
        <div className="mt-1 flex flex-col gap-2">
          {defaults.length === 0 && (
            <p className="text-(--gray-11) text-[12px]">No default folders.</p>
          )}
          {defaults.map((path) => (
            <div
              key={path}
              className="flex min-w-0 items-center gap-2 rounded-(--radius-2) border border-(--gray-5) bg-(--gray-2) px-2 py-1"
            >
              <Folder size={12} className="shrink-0 text-(--gray-11)" />
              <span
                className="min-w-0 flex-1 truncate text-[12px]"
                title={path}
              >
                {path}
              </span>
              <button
                type="button"
                aria-label={`Remove ${path}`}
                className="cursor-pointer p-0 opacity-60 hover:opacity-100"
                onClick={() => removeMutation.mutate({ path })}
              >
                <X size={12} />
              </button>
            </div>
          ))}
          <div>
            <Button
              size="sm"
              variant="outline"
              onClick={handleAddDefaultDirectory}
            >
              Add folder…
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
