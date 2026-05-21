import { PRBadgeLink } from "@features/git-interaction/components/PRBadgeLink";
import { useCloudPrUrl } from "@features/git-interaction/hooks/useCloudPrUrl";
import { useLinkedBranchPrUrl } from "@features/git-interaction/hooks/useLinkedBranchPrUrl";
import { usePrDetails } from "@features/git-interaction/hooks/usePrDetails";
import { useWorkspace } from "@features/workspace/hooks/useWorkspace";
import type { WorkspaceMode } from "@main/services/workspace/schemas";
import { useTRPC } from "@renderer/trpc";
import { selectIsFocusedOnWorktree, useFocusStore } from "@stores/focusStore";
import { useQuery } from "@tanstack/react-query";

interface CommandCenterPRButtonProps {
  taskId: string;
  workspaceMode: WorkspaceMode | null;
}

/**
 * PR badge for a task cell in the command center. Same visual and resolution
 * rules as the task page (TaskActionsMenu): cloud `pr_url` for cloud tasks,
 * linked-branch lookup with a local `getPrStatus` fallback for local tasks,
 * gated by `usePrDetails` returning a real PR state.
 */
export function CommandCenterPRButton({
  taskId,
  workspaceMode,
}: CommandCenterPRButtonProps) {
  const isCloud = workspaceMode === "cloud";

  const workspace = useWorkspace(taskId);
  const isFocused = useFocusStore(
    selectIsFocusedOnWorktree(workspace?.worktreePath ?? ""),
  );
  const localRepoPath = isFocused
    ? workspace?.folderPath
    : (workspace?.worktreePath ?? workspace?.folderPath);

  const trpc = useTRPC();
  const { data: prStatus } = useQuery(
    trpc.git.getPrStatus.queryOptions(
      { directoryPath: localRepoPath as string },
      {
        enabled: !isCloud && !!localRepoPath,
        staleTime: 30_000,
      },
    ),
  );

  const cloudPrUrl = useCloudPrUrl(taskId);
  const linkedPrUrl = useLinkedBranchPrUrl(taskId);
  const localPrUrl = prStatus?.prUrl ?? null;
  const prUrl = isCloud ? cloudPrUrl : (linkedPrUrl ?? localPrUrl);

  const {
    meta: { state, merged, draft },
  } = usePrDetails(prUrl);

  if (!prUrl || state === null) return null;

  return (
    <PRBadgeLink prUrl={prUrl} prState={state} merged={merged} draft={draft} />
  );
}
