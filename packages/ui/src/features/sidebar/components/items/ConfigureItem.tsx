import { SlidersHorizontal } from "@phosphor-icons/react";
import { SidebarItem } from "../SidebarItem";

interface ConfigureItemProps {
  onClick: () => void;
}

export function ConfigureItem({ onClick }: ConfigureItemProps) {
  return (
    <SidebarItem
      depth={0}
      icon={<SlidersHorizontal size={16} />}
      label="Configure"
      onClick={onClick}
    />
  );
}
