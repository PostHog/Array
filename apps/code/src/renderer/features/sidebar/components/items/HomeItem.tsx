import { House } from "@phosphor-icons/react";
import { Badge } from "@posthog/quill";
import { SidebarItem } from "../SidebarItem";

interface HomeItemProps {
  isActive: boolean;
  onClick: () => void;
  attentionCount?: number;
}

function formatAttentionCount(count: number): string {
  if (count > 99) return "99+";
  return String(count);
}

export function HomeItem({ isActive, onClick, attentionCount }: HomeItemProps) {
  return (
    <SidebarItem
      depth={0}
      icon={<House size={16} weight={isActive ? "fill" : "regular"} />}
      label={
        <>
          Home
          {attentionCount && attentionCount > 0 ? (
            <span
              className="ml-2 inline-flex shrink-0 items-center justify-center rounded-full bg-(--red-9) p-1 font-medium text-[10px] leading-none"
              style={{ color: "white" }}
              title={`${attentionCount} item${attentionCount === 1 ? "" : "s"} needing attention`}
            >
              {formatAttentionCount(attentionCount)}
            </span>
          ) : null}
        </>
      }
      isActive={isActive}
      onClick={onClick}
      endContent={<Badge variant="warning">Alpha</Badge>}
    />
  );
}
