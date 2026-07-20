import { AtIcon, LinkIcon } from "@phosphor-icons/react";
import {
  isMentionUnread,
  type MentionActivityItem,
} from "@posthog/core/canvas/mentionActivity";
import {
  Avatar,
  AvatarFallback,
  cn,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Spinner,
  ThreadItem,
  ThreadItemAction,
  ThreadItemActions,
  ThreadItemAuthor,
  ThreadItemBody,
  ThreadItemContent,
  ThreadItemGroup,
  ThreadItemGutter,
  ThreadItemHeader,
} from "@posthog/quill";
import { ANALYTICS_EVENTS } from "@posthog/shared/analytics-events";
import { useOptionalAuthenticatedClient } from "@posthog/ui/features/auth/authClient";
import { useCurrentUser } from "@posthog/ui/features/auth/useCurrentUser";
import { getUserInitials } from "@posthog/ui/features/auth/userInitials";
import { MentionText } from "@posthog/ui/features/canvas/components/MentionText";
import { ThreadScrollBody } from "@posthog/ui/features/canvas/components/ThreadScrollBody";
import { ThreadSidebar } from "@posthog/ui/features/canvas/components/ThreadSidebar";
import { ThreadTimestamp } from "@posthog/ui/features/canvas/components/ThreadTimestamp";
import { useChannels } from "@posthog/ui/features/canvas/hooks/useChannels";
import { useMentionActivity } from "@posthog/ui/features/canvas/hooks/useMentionActivity";
import { normalizeChannelName } from "@posthog/ui/features/canvas/hooks/useTaskChannels";
import { useActivitySeenStore } from "@posthog/ui/features/canvas/stores/activitySeenStore";
import {
  ACTIVITY_THREAD_KEY,
  useThreadPanelStore,
} from "@posthog/ui/features/canvas/stores/threadPanelStore";
import { copyChannelLink } from "@posthog/ui/features/canvas/utils/copyChannelLink";
import { userDisplayName } from "@posthog/ui/features/canvas/utils/userDisplay";
import {
  navigateToChannelTask,
  navigateToTaskDetail,
} from "@posthog/ui/router/navigationBridge";
import { track } from "@posthog/ui/shell/analytics";
import { Text } from "@radix-ui/themes";
import { useEffect, useMemo, useState } from "react";

function ActivityRow({
  item,
  folderChannelId,
  isNew,
  isOpen,
  currentUserEmail,
  onOpen,
}: {
  item: MentionActivityItem;
  /** Desktop folder channel id (the /website route param); null when unmapped. */
  folderChannelId: string | null;
  /** Unread: its thread hasn't been opened. */
  isNew: boolean;
  /** Its thread is the one open beside the list. */
  isOpen: boolean;
  currentUserEmail?: string | null;
  /** Reads the mention: opens its thread beside the list. */
  onOpen: () => void;
}) {
  const openThread = () => {
    track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
      action_type: "open_mention",
      surface: "activity",
      channel_id: folderChannelId ?? undefined,
      task_id: item.taskId,
    });
    onOpen();
  };

  return (
    <ThreadItem
      role="button"
      onClick={openThread}
      tabIndex={0}
      aria-current={isOpen || undefined}
      // Selected outranks hover: the panel beside the list is still this row's
      // thread whether or not the cursor happens to be resting on it.
      className={cn(
        "hover:bg-fill-hover/50",
        isOpen && "bg-fill-selected hover:bg-fill-selected",
      )}
    >
      <ThreadItemGutter>
        <span className="relative">
          <Avatar size="lg">
            <AvatarFallback>{getUserInitials(item.author)}</AvatarFallback>
          </Avatar>
          {isNew && (
            <span
              className="-top-0.5 -right-0.5 absolute size-2 rounded-full bg-(--red-9)"
              title="New mention"
            />
          )}
        </span>
      </ThreadItemGutter>
      <ThreadItemContent>
        <ThreadItemHeader>
          <ThreadItemAuthor>{userDisplayName(item.author)}</ThreadItemAuthor>
          <Text size="1" className="truncate text-muted-foreground">
            mentioned you
            {item.channelName && ` in ${item.channelName}`}
          </Text>
          <ThreadTimestamp dateTime={item.createdAt} />
        </ThreadItemHeader>
        <Text size="1" className="block truncate text-muted-foreground">
          {item.taskTitle}
        </Text>
        <ThreadItemBody>
          {/* The same window the thread panel gives an agent turn: a mention
              can be a whole essay, and one of those shouldn't push the next
              mention off the page. */}
          <ThreadScrollBody>
            <MentionText
              content={item.content}
              currentUserEmail={currentUserEmail}
              className="block whitespace-pre-wrap break-words"
            />
          </ThreadScrollBody>
        </ThreadItemBody>
      </ThreadItemContent>
      {folderChannelId && (
        <ThreadItemActions aria-label="Mention actions">
          <ThreadItemAction
            label="Copy thread link"
            onClick={() =>
              void copyChannelLink(folderChannelId, "activity", item.taskId)
            }
          >
            <LinkIcon size={14} />
          </ThreadItemAction>
        </ThreadItemActions>
      )}
    </ThreadItem>
  );
}

// The Activity page: every channel-thread message that @-mentions the viewer,
// newest first. Reading one means opening its thread; the page itself marks
// nothing, so the badge survives a glance at the list.
export function ActivityView() {
  const client = useOptionalAuthenticatedClient();
  const { data: currentUser } = useCurrentUser({ client });
  const { items, isLoading } = useMentionActivity();
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
  const threadTaskId = useThreadPanelStore(
    (s) => s.openByChannel[ACTIVITY_THREAD_KEY] ?? null,
  );
  // Which *mention* is on the right, not just which task. The panel only tracks
  // a task, and a task can be mentioned in several rows — keying the highlight
  // off it alone would light all of them for one click. Paired with the panel's
  // own state below, so closing the thread clears the highlight for free.
  const [openMessageId, setOpenMessageId] = useState<string | null>(null);
  const openThread = useThreadPanelStore((s) => s.openThread);
  const closeThread = useThreadPanelStore((s) => s.closeThread);
  // The panel's task card links into /website/$channelId, so a thread can only
  // open beside the list for a mention whose channel folder still resolves.
  const threadChannelId = threadTaskId
    ? folderChannelIdFor(
        items.find((item) => item.taskId === threadTaskId)?.channelName ?? null,
      )
    : null;

  const lastSeenAt = useActivitySeenStore((s) => s.lastSeenAt);
  const markMessageRead = useActivitySeenStore((s) => s.markMessageRead);
  // Snapshot the read set on arrival rather than subscribing: a mention you
  // open keeps its dot for the rest of the visit instead of vanishing under the
  // cursor, and the list doesn't re-render every time one is read. The sidebar
  // badge reads the live set, so it still drops immediately.
  const [readAtOpen] = useState(
    () => useActivitySeenStore.getState().readMessageIds,
  );

  useEffect(() => {
    track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
      action_type: "view_activity",
      surface: "activity",
    });
  }, []);

  return (
    <div className="flex h-full min-w-0 bg-gray-1">
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[680px] px-4 py-6">
          <Text size="5" weight="bold" className="block">
            Activity
          </Text>
          <Text size="2" className="block text-muted-foreground">
            Mentions of you across channels.
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
                    <AtIcon size={20} />
                  </EmptyMedia>
                  <EmptyTitle>No mentions yet</EmptyTitle>
                  <EmptyDescription>
                    When a teammate tags you with @ in a channel thread, it
                    lands here.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <ThreadItemGroup className="flex flex-col gap-2">
                {items.map((item) => {
                  const folderChannelId = folderChannelIdFor(item.channelName);
                  return (
                    <ActivityRow
                      key={item.messageId}
                      item={item}
                      folderChannelId={folderChannelId}
                      isNew={isMentionUnread(item, lastSeenAt, readAtOpen)}
                      isOpen={
                        item.messageId === openMessageId &&
                        item.taskId === threadTaskId
                      }
                      currentUserEmail={currentUser?.email}
                      onOpen={() => {
                        // Opening the thread is what reads the mention — the
                        // list itself never marks anything.
                        markMessageRead(item.messageId);
                        // Reading a mention shouldn't cost you the list. Without
                        // a channel folder there's no thread route to host, so
                        // those still fall through to the plain task view.
                        if (folderChannelId) {
                          setOpenMessageId(item.messageId);
                          openThread(ACTIVITY_THREAD_KEY, item.taskId);
                        } else {
                          navigateToTaskDetail(item.taskId);
                        }
                      }}
                    />
                  );
                })}
              </ThreadItemGroup>
            )}
          </div>
        </div>
      </div>

      {threadTaskId && threadChannelId && (
        <ThreadSidebar
          taskId={threadTaskId}
          channelId={threadChannelId}
          onClose={() => closeThread(ACTIVITY_THREAD_KEY)}
          onOpenFull={() =>
            navigateToChannelTask(threadChannelId, threadTaskId)
          }
        />
      )}
    </div>
  );
}
