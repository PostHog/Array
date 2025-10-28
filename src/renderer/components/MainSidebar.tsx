import { Sidebar, SidebarContent } from "@components/ui/sidebar";
import { Box } from "@radix-ui/themes";

export function MainSidebar() {
  return (
    <Box flexShrink="0" style={{ flexShrink: 0 }}>
      <Sidebar>
        <SidebarContent />
      </Sidebar>
    </Box>
  );
}
