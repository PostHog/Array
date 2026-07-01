import { useHostTRPC } from "@posthog/host-router/react";
import { useQuery } from "@tanstack/react-query";
import { useLocalRepoPath } from "../workspace/useLocalRepoPath";
import { useWorkspace } from "../workspace/useWorkspace";
import { useCloudPrUrl } from "./useCloudPrUrl";
import { useLinkedBranchPrUrl } from "./useLinkedBranchPrUrl";

/**
 * Resolves the PR URL for a task across all task kinds:
 *   - cloud: the cloud run's `pr_url`
 *   - local: the linked-branch lookup, falling back to `getPrStatus` on the
 *     active repo path
 *
 * On task switch we prefer the cached PR URL from the workspaces table so the
 * value is available synchronously — the live `gh` lookups still run and
 * supersede the cache as their values arrive.
 *
 * Shared by the task header (`TaskActionsMenu`) and the command center cell
 * header (`CommandCenterPRButton`) so they always agree on what PR a task
 * points at.
 */
export function useTaskPrUrl(taskId: string, isCloud: boolean): string | null {
  const cloudPrUrl = useCloudPrUrl(taskId);
  const workspace = useWorkspace(taskId);
  const linkedPrUrl = useLinkedBranchPrUrl({
    linkedBranch: workspace?.linkedBranch ?? null,
    folderPath: workspace?.folderPath ?? null,
  });
  const localRepoPath = useLocalRepoPath(taskId);

  const trpc = useHostTRPC();
  const { data: prStatus } = useQuery({
    ...trpc.git.getPrStatus.queryOptions({
      directoryPath: localRepoPath ?? "",
    }),
    enabled: !isCloud && !!localRepoPath,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  const { data: cached } = useQuery({
    ...trpc.workspace.getCachedPrUrl.queryOptions({ taskId }),
    enabled: !isCloud,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });

  if (isCloud) return cloudPrUrl;
  return linkedPrUrl ?? prStatus?.prUrl ?? cached?.prUrl ?? null;
}
