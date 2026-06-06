import { useArchivedTaskIds } from "@features/archive/hooks/useArchivedTaskIds";
import { SidebarUsageBar } from "@features/billing/components/SidebarUsageBar";
import { ArchiveIcon } from "@phosphor-icons/react";
import { Box, Flex } from "@radix-ui/themes";
import { navigateToArchived } from "@renderer/navigationBridge";
import type React from "react";
import { ProjectSwitcher } from "./ProjectSwitcher";
import { SidebarMenu } from "./SidebarMenu";
import { UpdateBanner } from "./UpdateBanner";

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
