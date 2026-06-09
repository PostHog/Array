import { House } from "@phosphor-icons/react";
import { Badge } from "@posthog/quill";
import { SidebarItem } from "../SidebarItem";
import { SidebarCountBadge } from "./SidebarCountBadge";

interface HomeItemProps {
  isActive: boolean;
  onClick: () => void;
  attentionCount?: number;
}

export function HomeItem({
  isActive,
  onClick,
  attentionCount = 0,
}: HomeItemProps) {
  return (
    <SidebarItem
      depth={0}
      icon={<House size={16} weight={isActive ? "fill" : "regular"} />}
      label={
        <>
          Home
          <SidebarCountBadge
            count={attentionCount}
            title={`${attentionCount} item${attentionCount === 1 ? "" : "s"} needing attention`}
          />
        </>
      }
      isActive={isActive}
      onClick={onClick}
      endContent={<Badge variant="warning">Alpha</Badge>}
    />
  );
}
