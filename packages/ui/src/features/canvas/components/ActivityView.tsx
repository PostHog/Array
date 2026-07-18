import { AtIcon, LinkIcon } from "@phosphor-icons/react";
import type { MentionActivityItem } from "@posthog/core/canvas/mentionActivity";
import {
  Avatar,
  AvatarFallback,
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
import { useCurrentUser } from "@posthog/ui/features/auth/useCurrentUser";
import { getUserInitials } from "@posthog/ui/features/auth/userInitials";
import { MentionText } from "@posthog/ui/features/canvas/components/MentionText";
import { ThreadSidebar } from "@posthog/ui/features/canvas/components/ThreadSidebar";
import { useChannels } from "@posthog/ui/features/canvas/hooks/useChannels";
import { useMentionActivity } from "@posthog/ui/features/canvas/hooks/useMentionActivity";
import { normalizeChannelName } from "@posthog/ui/features/canvas/hooks/useTaskChannels";
import { useActivitySeenStore } from "@posthog/ui/features/canvas/stores/activitySeenStore";
import { copyChannelLink } from "@posthog/ui/features/canvas/utils/copyChannelLink";
import { userDisplayName } from "@posthog/ui/features/canvas/utils/userDisplay";
import {
  navigateToChannelTask,
  navigateToTaskDetail,
} from "@posthog/ui/router/navigationBridge";
import { track } from "@posthog/ui/shell/analytics";
import { Text } from "@radix-ui/themes";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";

function ActivityRow({
  item,
  folderChannelId,
  isNew,
  isSelected,
  currentUserEmail,
  onOpen,
}: {
  item: MentionActivityItem;
  /** Desktop folder channel id (the /website route param); null when unmapped. */
  folderChannelId: string | null;
  /** Arrived since the viewer last opened this page. */
  isNew: boolean;
  /** This row's thread is the one currently open in the side panel. */
  isSelected: boolean;
  currentUserEmail?: string | null;
  onOpen: () => void;
}) {
  const openThread = () => {
    track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
      action_type: "open_mention",
      surface: "activity",
      channel_id: folderChannelId ?? undefined,
      task_id: item.taskId,
    });
    // Open the thread in the right-hand panel, scrolled to the mention — no
    // navigation away from Activity.
    onOpen();
  };

  return (
    <div className="group relative">
      <button
        type="button"
        onClick={openThread}
        className={`flex w-full gap-2 rounded-md px-2 py-2 text-left hover:bg-fill-secondary ${
          isSelected ? "bg-fill-secondary" : ""
        }`}
      >
        <span className="relative mt-0.5 shrink-0">
          <Avatar size="xs">
            <AvatarFallback>{getUserInitials(item.author)}</AvatarFallback>
          </Avatar>
          {isNew && (
            <span
              className="-top-0.5 -right-0.5 absolute h-2 w-2 rounded-full bg-(--red-9)"
              title="New mention"
            />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <Text size="1" className="truncate">
              <Text as="span" size="1" weight="medium">
                {userDisplayName(item.author)}
              </Text>{" "}
              mentioned you
              {item.channelName && (
                <>
                  {" in "}
                  <Text as="span" size="1" weight="medium">
                    {item.channelName}
                  </Text>
                </>
              )}
            </Text>
            <Text size="1" className="shrink-0 text-muted-foreground">
              {formatRelativeTimeShort(item.createdAt)}
            </Text>
          </span>
          <Text size="1" className="block truncate text-muted-foreground">
            {item.taskTitle}
          </Text>
          <MentionText
            content={item.content}
            currentUserEmail={currentUserEmail}
            className="mt-1 block whitespace-pre-wrap break-words text-xs"
          />
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

// The Activity page: every channel-thread message that @-mentions the viewer,
// newest first. Opening it clears the sidebar badge.
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
  const markSeen = useActivitySeenStore((s) => s.markSeen);
  // Snapshot before marking seen so rows that were new on arrival keep their
  // dot for this visit.
  const [seenAtOpen] = useState(
    () => useActivitySeenStore.getState().lastSeenAt,
  );
  // The mention whose thread is open in the right-hand panel. `messageId`
  // deep-links the ThreadPanel to scroll to and pulse that message.
  const [selected, setSelected] = useState<{
    taskId: string;
    channelId: string;
    messageId: string;
  } | null>(null);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
      action_type: "view_activity",
      surface: "activity",
    });
  }, []);

  // Re-mark as items stream in so the badge stays cleared while reading.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run per new item
  useEffect(() => {
    markSeen();
  }, [markSeen, items.length]);

  // Esc closes the open thread from anywhere in Activity — no need to have
  // focus inside the panel.
  useEffect(() => {
    if (!selected) return;
    const onKeyDown = (event: KeyboardEvent) => {
      // Let an open menu/popover consume Esc first (it preventDefaults).
      if (event.key === "Escape" && !event.defaultPrevented) setSelected(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selected]);

  return (
    <div className="flex h-full min-h-0 bg-gray-1">
      <div className="h-full min-w-0 flex-1 overflow-y-auto">
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
              <div className="flex flex-col gap-0.5">
                {items.map((item) => {
                  const folderChannelId = folderChannelIdFor(item.channelName);
                  return (
                    <ActivityRow
                      key={item.messageId}
                      item={item}
                      folderChannelId={folderChannelId}
                      isNew={!seenAtOpen || item.createdAt > seenAtOpen}
                      isSelected={selected?.messageId === item.messageId}
                      currentUserEmail={currentUser?.email}
                      onOpen={() =>
                        setSelected({
                          taskId: item.taskId,
                          channelId: folderChannelId ?? "",
                          messageId: item.messageId,
                        })
                      }
                    />
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
      {/* Slide the thread in/out by animating the wrapper width, so the list
          reflows in lockstep — same 200ms / cubic-bezier(0,0,0.2,1) the docked
          sidebar uses. `width: auto` (not a fixed px) once open so ThreadSidebar
          keeps owning its resizable width. Keyed "thread" so switching between
          mentions swaps the inner panel without a close/reopen. */}
      <AnimatePresence>
        {selected && (
          <motion.div
            key="thread"
            className="h-full shrink-0 overflow-hidden"
            initial={reduceMotion ? false : { width: 0, opacity: 0 }}
            animate={{ width: "auto", opacity: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { width: 0, opacity: 0 }}
            transition={{
              duration: reduceMotion ? 0 : 0.2,
              ease: [0, 0, 0.2, 1],
            }}
          >
            <ThreadSidebar
              // Remount per task so the mention-scroll starts fresh; switching
              // messages within the same task updates focusMessageId in place.
              key={selected.taskId}
              taskId={selected.taskId}
              channelId={selected.channelId}
              focusMessageId={selected.messageId}
              showTaskSummary={!!selected.channelId}
              onClose={() => setSelected(null)}
              onOpenFull={() =>
                selected.channelId
                  ? navigateToChannelTask(selected.channelId, selected.taskId)
                  : navigateToTaskDetail(selected.taskId)
              }
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
