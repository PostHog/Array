import { ChecksIcon } from "@phosphor-icons/react";
import { Button, PopoverContent, Spinner } from "@posthog/quill";
import { ANALYTICS_EVENTS } from "@posthog/shared/analytics-events";
import { useOptionalAuthenticatedClient } from "@posthog/ui/features/auth/authClient";
import { useCurrentUser } from "@posthog/ui/features/auth/useCurrentUser";
import { ActivityRow } from "@posthog/ui/features/canvas/components/ActivityView";
import { useChannels } from "@posthog/ui/features/canvas/hooks/useChannels";
import {
  useMarkAllTaskActivityRead,
  useMarkTaskActivityRead,
} from "@posthog/ui/features/canvas/hooks/useMarkTaskActivityRead";
import { useTaskActivity } from "@posthog/ui/features/canvas/hooks/useTaskActivity";
import { normalizeChannelName } from "@posthog/ui/features/canvas/hooks/useTaskChannels";
import { track } from "@posthog/ui/shell/analytics";
import { useEffect, useMemo } from "react";

export function ActivityHoverCard({ onClose }: { onClose: () => void }) {
  const client = useOptionalAuthenticatedClient();
  const { data: currentUser } = useCurrentUser({ client });
  const { items, isLoading, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useTaskActivity({ unreadOnly: true, limit: 500 });
  const unreadItems = items.filter((item) => item.isUnread);
  const { mutate: markTasksRead } = useMarkTaskActivityRead();
  const { mutate: markAllRead, isPending: isMarkingAllRead } =
    useMarkAllTaskActivityRead();
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

  return (
    <PopoverContent
      side="right"
      align="start"
      sideOffset={8}
      className="w-[420px] gap-2 p-2"
    >
      <div className="flex items-center justify-between px-2 pt-1">
        <span className="font-medium text-sm">Activity</span>
        {unreadItems.length > 0 && (
          <Button
            variant="default"
            size="sm"
            loading={isMarkingAllRead}
            disabled={isMarkingAllRead}
            onClick={() => markAllRead()}
          >
            <ChecksIcon size={14} />
            Mark all as read
          </Button>
        )}
      </div>
      <div className="max-h-[480px] overflow-y-auto">
        {isLoading && unreadItems.length === 0 ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : unreadItems.length === 0 ? (
          <div className="px-2 py-8 text-center text-muted-foreground text-sm">
            Okay.
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {unreadItems.map((item) => (
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
            {hasNextPage && (
              <Button
                variant="outline"
                className="mt-2 self-center"
                loading={isFetchingNextPage}
                disabled={isFetchingNextPage}
                onClick={() => void fetchNextPage()}
              >
                Load more
              </Button>
            )}
          </div>
        )}
      </div>
    </PopoverContent>
  );
}
