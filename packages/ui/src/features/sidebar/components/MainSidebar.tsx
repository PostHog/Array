import { useOnboardingStore } from "@posthog/ui/features/onboarding/onboardingStore";
import { Sidebar } from "@posthog/ui/features/sidebar/components/Sidebar";
import { SidebarContent } from "@posthog/ui/features/sidebar/components/SidebarContent";
import { useSidebarStore } from "@posthog/ui/features/sidebar/sidebarStore";
import { useTaskSelectionStore } from "@posthog/ui/features/sidebar/taskSelectionStore";
import { useWorkspaces } from "@posthog/ui/features/workspace/useWorkspace";
import { Box } from "@radix-ui/themes";
import { useEffect } from "react";

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
