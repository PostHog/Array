import { createSidebarStore } from "@posthog/ui/shell/createSidebarStore";

export const useInboxSignalsSidebarStore = createSidebarStore({
  name: "inbox-signals-sidebar-storage",
  defaultWidth: 380,
  defaultOpen: false,
});
