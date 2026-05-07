import {
  useLocalBranchChangedFiles,
  usePrChangedFiles,
} from "@features/git-interaction/hooks/useGitQueries";
import {
  computeDiffStats,
  type DiffStats,
} from "@features/git-interaction/utils/diffStats";
import { useCwd } from "@features/sidebar/hooks/useCwd";
import { useCloudChangedFiles } from "@features/task-detail/hooks/useCloudChangedFiles";
import { useWorkspace } from "@features/workspace/hooks/useWorkspace";
import type { Task } from "@shared/types";
import { useMemo } from "react";
import { useEffectiveDiffSource } from "./useEffectiveDiffSource";

export function useTaskDiffStats(task: Task): DiffStats {
  const taskId = task.id;
  const workspace = useWorkspace(taskId);
  const isCloud =
    workspace?.mode === "cloud" || task.latest_run?.environment === "cloud";

  const { reviewFiles } = useCloudChangedFiles(taskId, task, isCloud);

  const repoPath = useCwd(taskId);
  const {
    effectiveSource,
    linkedBranch,
    prUrl,
    diffStats: localDiffStats,
  } = useEffectiveDiffSource(taskId);

  const { data: branchFiles } = useLocalBranchChangedFiles(
    !isCloud && effectiveSource === "branch" ? (repoPath ?? null) : null,
    !isCloud && effectiveSource === "branch" ? linkedBranch : null,
  );
  const { data: prFiles } = usePrChangedFiles(
    !isCloud && effectiveSource === "pr" ? prUrl : null,
  );

  return useMemo<DiffStats>(() => {
    if (isCloud) return computeDiffStats(reviewFiles);
    if (effectiveSource === "branch" && branchFiles) {
      return computeDiffStats(branchFiles);
    }
    if (effectiveSource === "pr" && prFiles) {
      return computeDiffStats(prFiles);
    }
    return localDiffStats;
  }, [
    isCloud,
    reviewFiles,
    effectiveSource,
    branchFiles,
    prFiles,
    localDiffStats,
  ]);
}
