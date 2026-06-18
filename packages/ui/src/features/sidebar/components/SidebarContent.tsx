import { ArchiveIcon } from "@phosphor-icons/react";
import { useArchivedTaskIds } from "@posthog/ui/features/archive/useArchivedTaskIds";
import { SidebarUsageBar } from "@posthog/ui/features/billing/SidebarUsageBar";
import { ProjectSwitcher } from "@posthog/ui/features/sidebar/components/ProjectSwitcher";
import { SidebarMenu } from "@posthog/ui/features/sidebar/components/SidebarMenu";
import { UpdateBanner } from "@posthog/ui/features/sidebar/components/UpdateBanner";
import { navigateToArchived } from "@posthog/ui/router/navigationBridge";
import { Box, Flex } from "@radix-ui/themes";
import type React from "react";

export const SidebarContent: React.FC = () => {
  const archivedTaskIds = useArchivedTaskIds();
  return (
    <Flex direction="column" height="100%">
      <Box flexGrow="1" overflow="hidden">
        <SidebarMenu />
      </Box>
      <UpdateBanner />
      <SidebarUsageBar />
      {archivedTaskIds.size > 0 && (
        <Box className="shrink-0 border-gray-6 border-t">
          <button
            type="button"
            className="flex w-full items-center gap-1 bg-transparent px-2 py-1.5 text-left text-[13px] text-gray-11 transition-colors hover:bg-gray-3"
            onClick={navigateToArchived}
          >
            <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center text-gray-10">
              <ArchiveIcon size={14} />
            </span>
            <span className="text-gray-11">Archived</span>
          </button>
        </Box>
      )}
      <Box p="2" className="shrink-0 border-gray-6 border-t">
        <ProjectSwitcher />
      </Box>
    </Flex>
  );
};
