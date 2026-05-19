import { useOnboardingStore } from "@features/onboarding/stores/onboardingStore";
import { useWorkspaces } from "@features/workspace/hooks/useWorkspace";
import { Box } from "@radix-ui/themes";
import { useEffect } from "react";
import { useSidebarStore } from "../stores/sidebarStore";
import { Sidebar, SidebarContent } from "./index";

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

  return (
    <Box flexShrink="0" className="shrink-0">
      <Sidebar>
        <SidebarContent />
      </Sidebar>
    </Box>
  );
}
