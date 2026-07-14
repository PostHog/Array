import { CreditCard } from "@phosphor-icons/react";
import { SidebarItem } from "../SidebarItem";

interface UsageItemProps {
  onClick: () => void;
  depth?: number;
}

export function UsageItem({ onClick, depth = 0 }: UsageItemProps) {
  return (
    <SidebarItem
      depth={depth}
      icon={<CreditCard size={16} />}
      label="Usage"
      onClick={onClick}
    />
  );
}
