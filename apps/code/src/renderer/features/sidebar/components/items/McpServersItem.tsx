import { Plugs } from "@phosphor-icons/react";
import { SidebarItem } from "../SidebarItem";

interface McpServersItemProps {
  isActive: boolean;
  onClick: () => void;
}

export function McpServersItem({ isActive, onClick }: McpServersItemProps) {
  return (
    <SidebarItem
      depth={0}
      icon={<Plugs size={16} weight={isActive ? "fill" : "regular"} />}
      label="MCP servers"
      isActive={isActive}
      onClick={onClick}
    />
  );
}
