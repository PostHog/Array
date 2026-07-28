import { BellIcon } from "@phosphor-icons/react";
import { Popover, PopoverTrigger } from "@posthog/quill";
import { ActivityHoverCard } from "@posthog/ui/features/canvas/components/ActivityHoverCard";
import { useTaskActivity } from "@posthog/ui/features/canvas/hooks/useTaskActivity";
import { useState } from "react";
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
  const { unreadCount } = useTaskActivity();
  const [open, setOpen] = useState(false);
  const item = (
    <SidebarItem
      depth={depth}
      icon={<BellIcon size={16} weight={isActive ? "fill" : "regular"} />}
      label={
        <>
          Activity
          <SidebarCountBadge
            count={unreadCount}
            title={`${unreadCount} new ${unreadCount === 1 ? "update" : "updates"}`}
          />
        </>
      }
      isActive={isActive}
      onClick={() => {
        setOpen(false);
        onClick();
      }}
    />
  );
  if (isActive) return item;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        openOnHover
        delay={300}
        closeDelay={30}
        render={<div className="w-full">{item}</div>}
      />
      {open && <ActivityHoverCard onClose={() => setOpen(false)} />}
    </Popover>
  );
}
