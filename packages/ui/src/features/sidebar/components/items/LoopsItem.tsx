import { RepeatIcon } from "@phosphor-icons/react";
import { SidebarItem } from "../SidebarItem";

interface LoopsItemProps {
  isActive: boolean;
  onClick: () => void;
}

export function LoopsItem({ isActive, onClick }: LoopsItemProps) {
  return (
    <SidebarItem
      depth={0}
      icon={<RepeatIcon size={16} weight={isActive ? "fill" : "regular"} />}
      label="Loops"
      isActive={isActive}
      onClick={onClick}
    />
  );
}
