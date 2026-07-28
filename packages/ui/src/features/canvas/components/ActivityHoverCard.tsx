import { ChecksIcon } from "@phosphor-icons/react";
import { Button, PopoverContent, Spinner } from "@posthog/quill";
import { ANALYTICS_EVENTS } from "@posthog/shared/analytics-events";
import { useOptionalAuthenticatedClient } from "@posthog/ui/features/auth/authClient";
import { useCurrentUser } from "@posthog/ui/features/auth/useCurrentUser";
import { ActivityRow } from "@posthog/ui/features/canvas/components/ActivityView";
import { useChannels } from "@posthog/ui/features/canvas/hooks/useChannels";
import { useMarkTaskActivityRead } from "@posthog/ui/features/canvas/hooks/useMarkTaskActivityRead";
import { useTaskActivity } from "@posthog/ui/features/canvas/hooks/useTaskActivity";
import { normalizeChannelName } from "@posthog/ui/features/canvas/hooks/useTaskChannels";
import { track } from "@posthog/ui/shell/analytics";
import { useEffect, useMemo } from "react";

export function ActivityHoverCard({ onClose }: { onClose: () => void }) {
  const client = useOptionalAuthenticatedClient();
  const { data: currentUser } = useCurrentUser({ client });
  const { items, isLoading } = useTaskActivity();
  const unreadItems = items.filter((item) => item.isUnread);
  const { mutate: markTasksRead, isPending: isMarkingRead } =
    useMarkTaskActivityRead();
  const { channels } = useChannels();
  const folderIdByName = useMemo(
    () =>
      new Map(
        channels.map((channel) => [
          normalizeChannelName(channel.name),
          channel.id,
        ]),
      ),
    [channels],
  );
  useEffect(() => {
    track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
      action_type: "view_activity",
      surface: "activity_panel",
    });
  }, []);

  const markRead = (taskId: string, activityAt: string) => {
    markTasksRead([{ task_id: taskId, seen_before: activityAt }]);
  };

  const markAllRead = () => {
    markTasksRead(
      unreadItems.map((item) => ({
        task_id: item.taskId,
        seen_before: item.activityAt,
      })),
    );
  };

  return (
    <PopoverContent
      side="right"
      align="start"
      sideOffset={8}
      className="w-[380px] gap-0 overflow-hidden p-0"
    >
      <div className="flex min-h-12 items-center justify-between border-border border-b px-3">
        <span className="font-semibold text-sm">Activity</span>
        {unreadItems.length > 0 && (
          <Button
            variant="default"
            size="sm"
            loading={isMarkingRead}
            disabled={isMarkingRead}
            onClick={markAllRead}
          >
            <ChecksIcon size={14} />
            Mark all as read
          </Button>
        )}
      </div>
      <div className="max-h-[480px] overflow-y-auto p-1.5">
        {isLoading && items.length === 0 ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : items.length === 0 ? (
          <div className="px-2 py-8 text-center text-muted-foreground text-sm">
            No recent activity.
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {items.map((item) => (
              <ActivityRow
                key={item.taskId}
                item={item}
                folderChannelId={
                  item.channelName
                    ? (folderIdByName.get(
                        normalizeChannelName(item.channelName),
                      ) ?? null)
                    : null
                }
                onOpen={(activity) =>
                  markRead(activity.taskId, activity.activityAt)
                }
                onMarkRead={(activity) =>
                  markRead(activity.taskId, activity.activityAt)
                }
                currentUser={currentUser}
                surface="activity_panel"
                onNavigate={onClose}
              />
            ))}
          </div>
        )}
      </div>
    </PopoverContent>
  );
}
