import { BellIcon, LinkIcon } from "@phosphor-icons/react";
import type { TaskActivityItem } from "@posthog/core/canvas/taskActivity";
import {
  Button,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Spinner,
} from "@posthog/quill";
import { formatRelativeTimeShort } from "@posthog/shared";
import { ANALYTICS_EVENTS } from "@posthog/shared/analytics-events";
import { useOptionalAuthenticatedClient } from "@posthog/ui/features/auth/authClient";
import { UserAvatar } from "@posthog/ui/features/auth/UserAvatar";
import { useCurrentUser } from "@posthog/ui/features/auth/useCurrentUser";
import { MentionText } from "@posthog/ui/features/canvas/components/MentionText";
import { useChannels } from "@posthog/ui/features/canvas/hooks/useChannels";
import { useMarkTaskActivityRead } from "@posthog/ui/features/canvas/hooks/useMarkTaskActivityRead";
import { useTaskActivity } from "@posthog/ui/features/canvas/hooks/useTaskActivity";
import { normalizeChannelName } from "@posthog/ui/features/canvas/hooks/useTaskChannels";
import { copyChannelLink } from "@posthog/ui/features/canvas/utils/copyChannelLink";
import { userDisplayName } from "@posthog/ui/features/canvas/utils/userDisplay";
import {
  navigateToChannelTask,
  navigateToTaskDetail,
} from "@posthog/ui/router/navigationBridge";
import { track } from "@posthog/ui/shell/analytics";
import { Text } from "@radix-ui/themes";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo } from "react";

function ChannelSuffix({ channelName }: { channelName: string | null }) {
  if (!channelName) return null;
  return (
    <>
      {" in "}
      <Text as="span" size="1" weight="medium">
        {channelName}
      </Text>
    </>
  );
}

/** The lead line describing what happened, chosen by the row's activity kind. */
function activityHeadline(item: TaskActivityItem): ReactNode {
  switch (item.activityKind) {
    case "awaiting_input":
      return (
        <>
          {userDisplayName(item.author) || "The agent"} is waiting for your
          reply
          <ChannelSuffix channelName={item.channelName} />
        </>
      );
    case "message":
      return (
        <>
          You replied
          <ChannelSuffix channelName={item.channelName} />
        </>
      );
    case "mention":
      return (
        <>
          <Text as="span" size="1" weight="medium">
            {userDisplayName(item.author)}
          </Text>{" "}
          mentioned you
          <ChannelSuffix channelName={item.channelName} />
        </>
      );
    default:
      return "You created this task";
  }
}

function ActivityRow({
  item,
  folderChannelId,
  onOpen,
  currentUserEmail,
}: {
  item: TaskActivityItem;
  /** Desktop folder channel id (the /website route param); null when unmapped. */
  folderChannelId: string | null;
  onOpen: (item: TaskActivityItem) => void;
  currentUserEmail?: string | null;
}) {
  const openTask = () => {
    track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
      action_type: "open_task",
      surface: "activity",
      channel_id: folderChannelId ?? undefined,
      task_id: item.taskId,
    });
    onOpen(item);
    // The channel thread route is the deep-link target; tasks whose channel
    // folder is gone fall back to the plain task view.
    if (folderChannelId) {
      navigateToChannelTask(folderChannelId, item.taskId);
    } else {
      navigateToTaskDetail(item.taskId);
    }
  };

  return (
    <div className="group relative">
      <button
        type="button"
        onClick={openTask}
        className="flex w-full gap-2 rounded-md px-2 py-2 text-left hover:bg-fill-secondary"
      >
        <span className="relative mt-0.5 shrink-0">
          <UserAvatar user={item.author} size="xs" />
          {item.isUnread && (
            <span
              className="-top-0.5 -right-0.5 absolute h-2 w-2 rounded-full bg-(--red-9)"
              title="New activity"
            />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <Text size="1" className="truncate">
              {activityHeadline(item)}
            </Text>
            <Text size="1" className="shrink-0 text-muted-foreground">
              {formatRelativeTimeShort(item.activityAt)}
            </Text>
          </span>
          <Text size="1" className="block truncate text-muted-foreground">
            {item.taskTitle}
          </Text>
          {item.snippet && (
            <MentionText
              content={item.snippet}
              currentUserEmail={currentUserEmail}
              className="mt-1 block whitespace-pre-wrap break-words text-xs"
            />
          )}
        </span>
      </button>
      {folderChannelId && (
        <Button
          variant="default"
          size="icon-xs"
          aria-label="Copy thread link"
          className="absolute top-2 right-2 opacity-0 transition-opacity group-hover:opacity-100"
          onClick={() =>
            void copyChannelLink(folderChannelId, "activity", item.taskId)
          }
        >
          <LinkIcon size={14} />
        </Button>
      )}
    </div>
  );
}

// The Activity page: every task the viewer is involved in — created, mentioned
// in, or messaged in — newest activity first. Rows clear as they are opened, not
// when the page is; merely landing here shouldn't dismiss what you haven't read.
export function ActivityView() {
  const client = useOptionalAuthenticatedClient();
  const { data: currentUser } = useCurrentUser({ client });
  const { items, isLoading, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useTaskActivity();
  const { mutate: markTasksRead } = useMarkTaskActivityRead();
  // Opening a row is what marks it read. The server does the same when the task is
  // reached any other way, so the feed converges either way.
  const markRead = useCallback(
    (item: TaskActivityItem) =>
      markTasksRead([{ task_id: item.taskId, seen_before: item.activityAt }]),
    [markTasksRead],
  );
  // Items carry backend channel names only; the desktop folder-channel id
  // (needed for /website navigation and copy-link) is resolved here, where
  // the single useChannels subscription lives.
  const { channels: folderChannels } = useChannels();
  const folderIdByName = useMemo(
    () =>
      new Map(
        folderChannels.map((folder) => [
          normalizeChannelName(folder.name),
          folder.id,
        ]),
      ),
    [folderChannels],
  );
  const folderChannelIdFor = (channelName: string | null): string | null =>
    channelName
      ? (folderIdByName.get(normalizeChannelName(channelName)) ?? null)
      : null;
  useEffect(() => {
    track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
      action_type: "view_activity",
      surface: "activity",
    });
  }, []);

  return (
    <div className="h-full overflow-y-auto bg-gray-1">
      <div className="mx-auto w-full max-w-[680px] px-4 py-6">
        <Text size="5" weight="bold" className="block">
          Activity
        </Text>
        <Text size="2" className="block text-muted-foreground">
          Tasks you're involved in across channels.
        </Text>
        <div className="mt-4">
          {isLoading && items.length === 0 ? (
            <div className="flex justify-center py-16">
              <Spinner />
            </div>
          ) : items.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <BellIcon size={20} />
                </EmptyMedia>
                <EmptyTitle>No activity yet</EmptyTitle>
                <EmptyDescription>
                  Tasks you create, get tagged in, or reply to across channels
                  land here.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="flex flex-col gap-0.5">
              {items.map((item) => (
                <ActivityRow
                  key={item.taskId}
                  item={item}
                  folderChannelId={folderChannelIdFor(item.channelName)}
                  onOpen={markRead}
                  currentUserEmail={currentUser?.email}
                />
              ))}
              {hasNextPage && (
                <Button
                  variant="outline"
                  className="mt-3 self-center"
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
      </div>
    </div>
  );
}
