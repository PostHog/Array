import { Robot } from "@phosphor-icons/react";
import { SidebarItem } from "../SidebarItem";

interface AgentsItemProps {
  isActive: boolean;
  onClick: () => void;
}

export function AgentsItem({ isActive, onClick }: AgentsItemProps) {
  return (
    <SidebarItem
      depth={0}
      icon={<Robot size={16} weight={isActive ? "fill" : "regular"} />}
      label="Agents"
      isActive={isActive}
      onClick={onClick}
    />
  );
}
