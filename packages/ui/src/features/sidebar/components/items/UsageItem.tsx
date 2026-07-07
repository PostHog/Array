import { ChartLine } from "@phosphor-icons/react";
import { SidebarItem } from "../SidebarItem";

interface UsageItemProps {
  isActive: boolean;
  onClick: () => void;
}

export function UsageItem({ isActive, onClick }: UsageItemProps) {
  return (
    <SidebarItem
      depth={0}
      icon={<ChartLine size={16} weight={isActive ? "fill" : "regular"} />}
      label="Usage"
      isActive={isActive}
      onClick={onClick}
    />
  );
}
