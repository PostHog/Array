import { BellIcon } from "@phosphor-icons/react";
import { countUnseenActivity } from "@posthog/core/canvas/taskActivity";
import { useTaskActivity } from "@posthog/ui/features/canvas/hooks/useTaskActivity";
import { useActivitySeenStore } from "@posthog/ui/features/canvas/stores/activitySeenStore";
import { useMemo } from "react";
import { SidebarItem } from "../SidebarItem";
import { SidebarCountBadge } from "./SidebarCountBadge";

interface ActivityItemProps {
  isActive: boolean;
  onClick: () => void;
  depth?: number;
}

// The Activity nav row with its unread dot. Owns the task-activity subscription
// so the query mounts once here; the badge counts tasks whose activity is newer
// than the last time the Activity page was opened.
export function ActivityItem({
  isActive,
  onClick,
  depth = 0,
}: ActivityItemProps) {
  const { items } = useTaskActivity();
  const lastSeenAt = useActivitySeenStore((s) => s.lastSeenAt);
  const unseen = useMemo(
    () => countUnseenActivity(items, lastSeenAt),
    [items, lastSeenAt],
  );
  return (
    <SidebarItem
      depth={depth}
      icon={<BellIcon size={16} weight={isActive ? "fill" : "regular"} />}
      label={
        <>
          Activity
          <SidebarCountBadge
            count={unseen}
            title={`${unseen} new ${unseen === 1 ? "update" : "updates"}`}
          />
        </>
      }
      isActive={isActive}
      onClick={onClick}
    />
  );
}
