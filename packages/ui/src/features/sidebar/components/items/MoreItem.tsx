import { CaretDown } from "@phosphor-icons/react";
import { cn } from "@posthog/quill";
import { SidebarItem } from "../SidebarItem";

interface MoreItemProps {
  expanded: boolean;
  // Label of the active hidden item, shown in place of "More" while
  // collapsed so the current page stays visible in the nav.
  activeItemLabel?: string | null;
  onClick: () => void;
}

export function MoreItem({
  expanded,
  activeItemLabel,
  onClick,
}: MoreItemProps) {
  return (
    <SidebarItem
      depth={0}
      icon={
        <CaretDown
          size={16}
          className={cn("transition-transform", expanded && "rotate-180")}
        />
      }
      label={activeItemLabel ?? "More"}
      isActive={Boolean(activeItemLabel)}
      onClick={onClick}
    />
  );
}
