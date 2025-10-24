import { SidebarSimpleIcon } from "@phosphor-icons/react";
import { IconButton } from "@radix-ui/themes";
import type React from "react";
import { useSidebarStore } from "../../../stores/sidebarStore";

export const SidebarTrigger: React.FC = () => {
  const open = useSidebarStore((state) => state.open);
  const setOpen = useSidebarStore((state) => state.setOpen);

  return (
    <IconButton
      variant="ghost"
      color="gray"
      onClick={() => setOpen(!open)}
      className="no-drag"
    >
      <SidebarSimpleIcon size={16} />
    </IconButton>
  );
};
