import { useOnboardingStore } from "@features/onboarding/stores/onboardingStore";
import { useWorkspaces } from "@features/workspace/hooks/useWorkspace";
import { Box } from "@radix-ui/themes";
import { useEffect } from "react";
import { useSidebarStore } from "../stores/sidebarStore";
import { useTaskSelectionStore } from "../stores/taskSelectionStore";
import { Sidebar, SidebarContent } from "./index";

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export function MainSidebar() {
  const { data: workspaces = {}, isFetched } = useWorkspaces();
  const hasCompletedOnboarding = useOnboardingStore(
    (state) => state.hasCompletedOnboarding,
  );
  const setOpenAuto = useSidebarStore((state) => state.setOpenAuto);

  useEffect(() => {
    if (isFetched) {
      const workspaceCount = Object.keys(workspaces).length;
      setOpenAuto(hasCompletedOnboarding || workspaceCount > 0);
    }
  }, [isFetched, workspaces, hasCompletedOnboarding, setOpenAuto]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (isEditableTarget(e.target)) return;
      const { selectedTaskIds, clearSelection } =
        useTaskSelectionStore.getState();
      if (selectedTaskIds.length === 0) return;
      clearSelection();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <Box flexShrink="0" className="shrink-0">
      <Sidebar>
        <SidebarContent />
      </Sidebar>
    </Box>
  );
}
