import type { TaskPrRef } from "@shared/types/pr-snapshot";
import { useMemo } from "react";
import { buildDemoSnapshot, EMPTY_SNAPSHOT } from "../fixtures/demoSnapshot";
import { useHomeDemoStore } from "../stores/homeDemoStore";
import {
  buildSnapshotFromTasks,
  type HomeSnapshot,
} from "../utils/buildSnapshot";
import { useHomeTasks } from "./useHomeTasks";
import { usePrSnapshots } from "./usePrSnapshots";

export function useHomeSnapshot(): {
  snapshot: HomeSnapshot;
  isLoading: boolean;
  isDemo: boolean;
} {
  const { pinnedTasks, flatTasks, isLoading } = useHomeTasks();
  const demoScenario = useHomeDemoStore((s) => s.scenario);

  // Tasks worth resolving a PR for: a cloud PR URL, a branch (which may have a
  // PR), or a worktree. Skipped in demo mode, which supplies its own fixtures.
  const prRefs = useMemo<TaskPrRef[]>(() => {
    if (demoScenario !== "off") return [];
    const refs: TaskPrRef[] = [];
    for (const task of [...pinnedTasks, ...flatTasks]) {
      if (
        task.cloudPrUrl ||
        task.linkedBranch ||
        task.branchName ||
        task.folderPath
      ) {
        refs.push({ taskId: task.id, cloudPrUrl: task.cloudPrUrl });
      }
    }
    return refs;
  }, [demoScenario, pinnedTasks, flatTasks]);

  const prByTaskId = usePrSnapshots(prRefs);

  const realSnapshot = useMemo(
    () => buildSnapshotFromTasks(pinnedTasks, flatTasks, prByTaskId),
    [pinnedTasks, flatTasks, prByTaskId],
  );

  const snapshot = useMemo(() => {
    if (demoScenario === "populated") return buildDemoSnapshot();
    if (demoScenario === "empty") return EMPTY_SNAPSHOT;
    return realSnapshot;
  }, [demoScenario, realSnapshot]);

  return {
    snapshot,
    isLoading: demoScenario !== "off" ? false : isLoading,
    isDemo: demoScenario !== "off",
  };
}
