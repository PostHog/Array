import { BellIcon } from "@phosphor-icons/react";
import { countUnreadMentions } from "@posthog/core/canvas/mentionActivity";
import { useMentionActivity } from "@posthog/ui/features/canvas/hooks/useMentionActivity";
import { useActivitySeenStore } from "@posthog/ui/features/canvas/stores/activitySeenStore";
import { useMemo } from "react";
import { SidebarItem } from "../SidebarItem";
import { SidebarCountBadge } from "./SidebarCountBadge";

interface ActivityItemProps {
  isActive: boolean;
  onClick: () => void;
}

// The Activity nav row with its unread-mentions dot. Owns the mentions
// subscription so the query mounts once here; the badge counts mentions whose
// thread the viewer hasn't opened — visiting the page doesn't clear it.
export function ActivityItem({ isActive, onClick }: ActivityItemProps) {
  const { items } = useMentionActivity();
  const lastSeenAt = useActivitySeenStore((s) => s.lastSeenAt);
  const readMessageIds = useActivitySeenStore((s) => s.readMessageIds);
  const unseen = useMemo(
    () => countUnreadMentions(items, lastSeenAt, readMessageIds),
    [items, lastSeenAt, readMessageIds],
  );
  return (
    <SidebarItem
      depth={0}
      icon={<BellIcon size={16} weight={isActive ? "fill" : "regular"} />}
      label={
        <>
          Activity
          <SidebarCountBadge
            count={unseen}
            title={`${unseen} new ${unseen === 1 ? "mention" : "mentions"}`}
          />
        </>
      }
      isActive={isActive}
      onClick={onClick}
    />
  );
}
