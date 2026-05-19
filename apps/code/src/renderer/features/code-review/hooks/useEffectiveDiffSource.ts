import { useDiffViewerStore } from "@features/code-editor/stores/diffViewerStore";
import { useLinkedBranchPrUrl } from "@features/git-interaction/hooks/useLinkedBranchPrUrl";
import type { DiffStats } from "@features/git-interaction/utils/diffStats";
import { useCwd } from "@features/sidebar/hooks/useCwd";
import { useWorkspace } from "@features/workspace/hooks/useWorkspace";
import { useTRPC } from "@renderer/trpc";
import { useQuery } from "@tanstack/react-query";
import {
  type ResolvedDiffSource,
  resolveDiffSource,
} from "../utils/resolveDiffSource";

export interface EffectiveDiffSource {
  effectiveSource: ResolvedDiffSource;
  prUrl: string | null;
  linkedBranch: string | null;
  defaultBranch: string | null;
  repoSlug: string | null;
  branchSourceAvailable: boolean;
  prSourceAvailable: boolean;
  diffStats: DiffStats;
}

export function useEffectiveDiffSource(taskId: string): EffectiveDiffSource {
  const trpc = useTRPC();
  const repoPath = useCwd(taskId);
  const workspace = useWorkspace(taskId);
  const linkedBranch = workspace?.linkedBranch ?? null;

  const configured = useDiffViewerStore((s) => s.diffSource[taskId] ?? null);

  const enabled = !!repoPath;
  const emptyDiffStats: DiffStats = {
    filesChanged: 0,
    linesAdded: 0,
    linesRemoved: 0,
  };

  const { data: syncStatus } = useQuery(
    trpc.git.getGitSyncStatus.queryOptions(
      { directoryPath: repoPath as string },
      {
        enabled,
        staleTime: 30_000,
      },
    ),
  );

  const { data: repoInfo } = useQuery(
    trpc.git.getGitRepoInfo.queryOptions(
      { directoryPath: repoPath as string },
      {
        enabled,
        staleTime: 60_000,
      },
    ),
  );

  const { data: diffStats = emptyDiffStats } = useQuery(
    trpc.git.getDiffStats.queryOptions(
      { directoryPath: repoPath as string },
      {
        enabled,
        staleTime: 30_000,
        placeholderData: (prev) => prev ?? emptyDiffStats,
      },
    ),
  );

  const aheadOfDefault = syncStatus?.aheadOfDefault ?? 0;
  const defaultBranch = repoInfo?.defaultBranch ?? null;
  const hasLocalChanges = diffStats.filesChanged > 0;
  const branchSourceAvailable = !!linkedBranch && aheadOfDefault > 0;

  const prUrl = useLinkedBranchPrUrl(taskId);
  const prSourceAvailable = !!prUrl;

  const repoSlug = repoInfo
    ? `${repoInfo.organization}/${repoInfo.repository}`
    : null;

  const effectiveSource = resolveDiffSource({
    configured,
    hasLocalChanges,
    linkedBranch,
    aheadOfDefault,
    prSourceAvailable,
  });

  return {
    effectiveSource,
    prUrl,
    linkedBranch,
    defaultBranch,
    repoSlug,
    branchSourceAvailable,
    prSourceAvailable,
    diffStats,
  };
}
