import { CreditCard } from "@phosphor-icons/react";
import { SidebarItem } from "../SidebarItem";

interface BillingItemProps {
  isActive: boolean;
  onClick: () => void;
}

export function BillingItem({ isActive, onClick }: BillingItemProps) {
  return (
    <SidebarItem
      depth={0}
      icon={<CreditCard size={16} weight={isActive ? "fill" : "regular"} />}
      label="Plan & usage"
      isActive={isActive}
      onClick={onClick}
    />
  );
}
