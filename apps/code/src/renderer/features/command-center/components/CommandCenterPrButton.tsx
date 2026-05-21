import { useCloudPrUrl } from "@features/git-interaction/hooks/useCloudPrUrl";
import { useLinkedBranchPrUrl } from "@features/git-interaction/hooks/useLinkedBranchPrUrl";
import { usePrDetails } from "@features/git-interaction/hooks/usePrDetails";
import {
  getPrVisualConfig,
  parsePrNumber,
} from "@features/git-interaction/utils/prStatus";
import { useWorkspace } from "@features/workspace/hooks/useWorkspace";
import type { WorkspaceMode } from "@main/services/workspace/schemas";
import { GitMerge, GitPullRequest } from "@phosphor-icons/react";
import { useTRPC } from "@renderer/trpc";
import { selectIsFocusedOnWorktree, useFocusStore } from "@stores/focusStore";
import { useQuery } from "@tanstack/react-query";

interface CommandCenterPrButtonProps {
  taskId: string;
  workspaceMode: WorkspaceMode | null;
}

const COLOR_CLASSES: Record<"gray" | "green" | "red" | "purple", string> = {
  gray: "bg-(--gray-3) text-(--gray-11) hover:bg-(--gray-4)",
  green: "bg-(--green-3) text-(--green-11) hover:bg-(--green-4)",
  red: "bg-(--red-3) text-(--red-11) hover:bg-(--red-4)",
  purple: "bg-(--purple-3) text-(--purple-11) hover:bg-(--purple-4)",
};

export function CommandCenterPrButton({
  taskId,
  workspaceMode,
}: CommandCenterPrButtonProps) {
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

  const config = getPrVisualConfig(state, merged, draft);
  const prNumber = parsePrNumber(prUrl);
  const Icon = merged ? GitMerge : GitPullRequest;

  return (
    <a
      href={prUrl}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      title={`${config.label} PR${prNumber ? ` #${prNumber}` : ""}`}
      className={`inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] transition-colors ${COLOR_CLASSES[config.color]}`}
    >
      <Icon size={10} weight="bold" />
      {prNumber ? `#${prNumber}` : config.label}
    </a>
  );
}
