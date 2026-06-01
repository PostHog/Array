import {
  type SidebarData,
  useSidebarData,
} from "@features/sidebar/hooks/useSidebarData";
import { useNavigationStore } from "@stores/navigationStore";
import { useMemo } from "react";
import { buildDemoSnapshot, EMPTY_SNAPSHOT } from "../fixtures/demoSnapshot";
import { useHomeDemoStore } from "../stores/homeDemoStore";
import {
  buildSnapshotFromTasks,
  type HomeSnapshot,
} from "../utils/buildSnapshot";

export function useHomeSnapshot(): {
  snapshot: HomeSnapshot;
  isLoading: boolean;
  sidebarData: SidebarData;
  isDemo: boolean;
} {
  const view = useNavigationStore((s) => s.view);
  const sidebarData = useSidebarData({ activeView: view });
  const demoScenario = useHomeDemoStore((s) => s.scenario);

  const realSnapshot = useMemo(
    () =>
      buildSnapshotFromTasks(sidebarData.pinnedTasks, sidebarData.flatTasks),
    [sidebarData.pinnedTasks, sidebarData.flatTasks],
  );

  const snapshot = useMemo(() => {
    if (demoScenario === "populated") return buildDemoSnapshot();
    if (demoScenario === "empty") return EMPTY_SNAPSHOT;
    return realSnapshot;
  }, [demoScenario, realSnapshot]);

  return {
    snapshot,
    isLoading: demoScenario !== "off" ? false : sidebarData.isLoading,
    sidebarData,
    isDemo: demoScenario !== "off",
  };
}
