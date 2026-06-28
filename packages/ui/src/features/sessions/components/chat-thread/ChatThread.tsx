import { ChatCircle } from "@phosphor-icons/react";
import { WorkerPoolContextProvider } from "@pierre/diffs/react";
import { useService } from "@posthog/di/react";
import {
  Button,
  ChatBubble,
  ChatBubbleContent,
  ChatMessage,
  ChatMessageContent,
  ChatMessageScroller,
  ChatMessageScrollerButton,
  ChatMessageScrollerContent,
  ChatMessageScrollerItem,
  ChatMessageScrollerProvider,
  ChatMessageScrollerViewport,
  useChatMessageScroller,
  useChatMessageScrollerVisibility,
} from "@posthog/quill";
import type { ConversationItem } from "@posthog/ui/features/sessions/components/buildConversationItems";
import { ChatMarkdown } from "@posthog/ui/features/sessions/components/chat-thread/ChatMarkdown";
import { ChatThreadChromeProvider } from "@posthog/ui/features/sessions/components/chat-thread/chatThreadChrome";
import { GitActionMessage } from "@posthog/ui/features/sessions/components/GitActionMessage";
import { GitActionResult } from "@posthog/ui/features/sessions/components/GitActionResult";
import { mergeConversationItems } from "@posthog/ui/features/sessions/components/mergeConversationItems";
import { SessionUpdateView } from "@posthog/ui/features/sessions/components/session-update/SessionUpdateView";
import { UserShellExecuteView } from "@posthog/ui/features/sessions/components/session-update/UserShellExecuteView";
import { CHAT_CONTENT_MAX_WIDTH } from "@posthog/ui/features/sessions/constants";
import { useConversationItems } from "@posthog/ui/features/sessions/hooks/useConversationItems";
import {
  useOptimisticItemsForTask,
  useSessionForTask,
} from "@posthog/ui/features/sessions/sessionStore";
import { SessionTaskIdProvider } from "@posthog/ui/features/sessions/useSessionTaskId";
import { useSettingsStore } from "@posthog/ui/features/settings/settingsStore";
import { SkillButtonActionMessage } from "@posthog/ui/features/skill-buttons/components/SkillButtonActionMessage";
import {
  DIFF_WORKER_FACTORY,
  type DiffWorkerFactory,
} from "@posthog/ui/shell/diffWorkerHost";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import type { ConversationViewProps } from "../ConversationView";

const DIFFS_HIGHLIGHTER_OPTIONS = {
  theme: { dark: "github-dark" as const, light: "github-light" as const },
};

/** Plain end-aligned user bubble. Full content — the pinned preview is the separate overlay. */
function UserBubble({ content }: { content: string }) {
  return (
    <ChatMessage align="end">
      <ChatMessageContent>
        <ChatBubble align="end" variant="default">
          <ChatBubbleContent>
            <ChatMarkdown content={content} />
          </ChatBubbleContent>
        </ChatBubble>
      </ChatMessageContent>
    </ChatMessage>
  );
}

/**
 * "Fake sticky" header. A real `position: sticky` row can't hand off in this flat list (every row
 * shares one containing block, so they'd pile at the top) and sticking causes reflow. Instead we
 * overlay a single header, out of flow, pinned over the viewport top — showing the current turn's
 * user message (the engine's anchor) once the real one has scrolled off. Click to scroll back to it.
 *
 * Only this small component subscribes to the engine's per-scroll visibility state, so the rows
 * themselves never re-render on scroll.
 */
function StickyHeaderOverlay({ items }: { items: ConversationItem[] }) {
  const { currentAnchorId, visibleMessageIds } =
    useChatMessageScrollerVisibility();
  const { scrollToMessage } = useChatMessageScroller();
  const shouldReduceMotion = useReducedMotion();
  const [dismissedId, setDismissedId] = useState<string | null>(null);

  const active = items.find(
    (i): i is Extract<ConversationItem, { type: "user_message" }> =>
      i.id === currentAnchorId && i.type === "user_message",
  );
  const offscreen = active != null && !visibleMessageIds.includes(active.id);

  // Once the real message is back on screen, clear the dismissal so the header can return later.
  useEffect(() => {
    if (!offscreen) setDismissedId(null);
  }, [offscreen]);

  const dismiss = (id: string) => {
    // Hide immediately on click (don't wait for the scroll to bring the message into view), then
    // jump to it.
    setDismissedId(id);
    scrollToMessage(id);
  };

  return (
    <AnimatePresence>
      {active != null && offscreen && active.id !== dismissedId && (
        <motion.div
          key="chat-sticky-header"
          // Slide in slightly from the top + fade (ease-out-cubic). Exit a touch faster.
          initial={shouldReduceMotion ? false : { opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={
            shouldReduceMotion
              ? { opacity: 0 }
              : { opacity: 0, y: -8, transition: { duration: 0.15 } }
          }
          transition={{ duration: 0.2, ease: [0.215, 0.61, 0.355, 1] }}
          // pointer-events-none on the strip so only the button catches clicks — the rest stays
          // transparent to the content scrolling underneath.
          className="pointer-events-none absolute inset-x-0 top-2 z-10"
        >
          {/* Align to the content column's right edge (matches the message rows) rather than the
              viewport edge, so the button reads in-context with the conversation. */}
          <div
            className="mx-auto flex w-full justify-end px-2"
            style={{ maxWidth: CHAT_CONTENT_MAX_WIDTH }}
          >
            <Button
              type="button"
              variant="outline"
              size="icon"
              title="Jump to your message"
              aria-label="Jump to your message"
              onClick={() => dismiss(active.id)}
              className="pointer-events-auto rounded-full bg-background shadow-md"
            >
              <ChatCircle />
            </Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * One transcript row. Memoized and scroll-state-free, so rows never re-render while scrolling — the
 * non-virtualized thread stays cheap. The pinned header is the separate overlay, not the rows.
 */
const ThreadRow = memo(function ThreadRow({
  item,
  renderItem,
}: {
  item: ConversationItem;
  renderItem: (item: ConversationItem) => ReactNode;
}) {
  return (
    <ChatMessageScrollerItem
      messageId={item.id}
      scrollAnchor={item.type === "user_message"}
      className="mx-auto w-full px-2 empty:hidden"
      style={{ maxWidth: CHAT_CONTENT_MAX_WIDTH }}
    >
      {item.type === "user_message" ? (
        <UserBubble content={item.content} />
      ) : (
        renderItem(item)
      )}
    </ChatMessageScrollerItem>
  );
});

/** The scroll body, under the Provider so the overlay + scroll-button hooks can read engine state. */
function ThreadScrollBody({
  items,
  renderItem,
}: {
  items: ConversationItem[];
  renderItem: (item: ConversationItem) => ReactNode;
}) {
  return (
    <ChatMessageScroller>
      <StickyHeaderOverlay items={items} />
      <ChatMessageScrollerViewport>
        <ChatMessageScrollerContent className="py-4">
          {items.map((item) => (
            <ThreadRow key={item.id} item={item} renderItem={renderItem} />
          ))}
        </ChatMessageScrollerContent>
      </ChatMessageScrollerViewport>
      <ChatMessageScrollerButton />
    </ChatMessageScroller>
  );
}

/**
 * Experimental thread renderer built on the new ChatX (quill) primitives.
 *
 * Reuses the existing parse pipeline (`useConversationItems`) and the non-virtualized
 * `ChatMessageScroller` (`content-visibility: auto`). User + assistant turns render through
 * `ChatMessage`/`ChatBubble` (end-aligned filled / start-aligned ghost) with our own `ChatMarkdown`.
 * Tool calls render as `ChatMarker` — `ChatThreadChromeProvider` flips the shared `ToolRow` chrome
 * to the ChatX primitive, so every tool view is mapped without forking. Still TODO: per-turn tool
 * grouping, and mention chips / attachments / timestamps on user messages.
 *
 * Swapped in behind `settingsStore.useNewChatThread` via `ThreadView`.
 */
export function ChatThread({
  events,
  isPromptPending,
  repoPath,
  taskId,
}: ConversationViewProps) {
  const diffWorkerFactory = useService<DiffWorkerFactory>(DIFF_WORKER_FACTORY);
  const diffsPoolOptions = useMemo(
    () => ({
      workerFactory: () => diffWorkerFactory(),
      totalASTLRUCacheSize: 200,
    }),
    [diffWorkerFactory],
  );

  const showDebugLogs = useSettingsStore((s) => s.debugLogsCloudRuns);

  const { items: conversationItems } = useConversationItems(
    events,
    isPromptPending,
    { showDebugLogs },
  );

  const optimisticItems = useOptimisticItemsForTask(taskId);
  const isCloud = useSessionForTask(taskId)?.isCloud ?? false;

  const items = useMemo<ConversationItem[]>(
    () =>
      mergeConversationItems({ conversationItems, optimisticItems, isCloud }),
    [conversationItems, optimisticItems, isCloud],
  );

  const renderItem = useCallback(
    (item: ConversationItem) => {
      switch (item.type) {
        // user_message is rendered by ThreadScrollBody (it needs the active-anchor state for sticky).
        // NOTE: mention chips / attachments / timestamp are dropped in this slice — just the bubble
        // surface + markdown. Re-add via ChatAttachment + ChatMessageFooter later.
        case "user_message":
          return null;
        case "git_action":
          return <GitActionMessage actionType={item.actionType} />;
        case "skill_button_action":
          return <SkillButtonActionMessage buttonId={item.buttonId} />;
        case "session_update": {
          const update = item.update;
          // Assistant prose → start-aligned ghost bubble. Everything else (tool calls, thoughts,
          // console, status) keeps the existing renderer for now — ChatMarker mapping is next.
          if (
            update.sessionUpdate === "agent_message_chunk" &&
            update.content.type === "text"
          ) {
            return (
              <ChatMessage align="start">
                <ChatMessageContent>
                  <ChatBubble variant="ghost">
                    <ChatBubbleContent>
                      <ChatMarkdown content={update.content.text} />
                    </ChatBubbleContent>
                  </ChatBubble>
                </ChatMessageContent>
              </ChatMessage>
            );
          }
          return (
            <SessionUpdateView
              item={item.update}
              toolCalls={item.turnContext.toolCalls}
              childItems={item.turnContext.childItems}
              turnCancelled={item.turnContext.turnCancelled}
              turnComplete={item.turnContext.turnComplete}
              thoughtComplete={item.thoughtComplete}
            />
          );
        }
        case "git_action_result":
          return repoPath ? (
            <GitActionResult
              actionType={item.actionType}
              repoPath={repoPath}
              turnId={item.turnId}
            />
          ) : null;
        case "turn_cancelled":
          return null;
        case "user_shell_execute":
          return <UserShellExecuteView item={item} />;
      }
    },
    [repoPath],
  );

  return (
    <WorkerPoolContextProvider
      poolOptions={diffsPoolOptions}
      highlighterOptions={DIFFS_HIGHLIGHTER_OPTIONS}
    >
      <SessionTaskIdProvider taskId={taskId}>
        <ChatThreadChromeProvider value={true}>
          <ChatMessageScrollerProvider
            autoScroll
            defaultScrollPosition="end"
            scrollPreviousItemPeek={64}
          >
            <ThreadScrollBody items={items} renderItem={renderItem} />
          </ChatMessageScrollerProvider>
        </ChatThreadChromeProvider>
      </SessionTaskIdProvider>
    </WorkerPoolContextProvider>
  );
}
