import { SlidersHorizontal } from "@phosphor-icons/react";
import { SidebarItem } from "../SidebarItem";

interface CustomizeSidebarItemProps {
  onClick: () => void;
  depth?: number;
}

export function CustomizeSidebarItem({
  onClick,
  depth = 0,
}: CustomizeSidebarItemProps) {
  return (
    <SidebarItem
      depth={depth}
      icon={<SlidersHorizontal size={16} />}
      label="Customize sidebar"
      onClick={onClick}
    />
  );
}
