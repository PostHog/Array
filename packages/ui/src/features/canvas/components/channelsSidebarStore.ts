import { createSidebarStore } from "@posthog/ui/shell/createSidebarStore";

export const useChannelsSidebarStore = createSidebarStore({
  name: "channels-sidebar",
  defaultWidth: 240,
});
