import { CaretDown, ChatCircle, FileText, Scroll } from "@phosphor-icons/react";
import { WorkerPoolContextProvider } from "@pierre/diffs/react";
import { useService } from "@posthog/di/react";
import {
  Button,
  ChatBubble,
  ChatBubbleContent,
  ChatMarker,
  ChatMarkerContent,
  ChatMessage,
  ChatMessageContent,
  ChatMessageFooter,
  ChatMessageHeader,
  ChatMessageScroller,
  ChatMessageScrollerButton,
  ChatMessageScrollerContent,
  ChatMessageScrollerItem,
  ChatMessageScrollerProvider,
  ChatMessageScrollerViewport,
  cn,
  useChatMessageScroller,
  useChatMessageScrollerVisibility,
} from "@posthog/quill";
import { PROJECT_BLUEBIRD_FLAG } from "@posthog/shared";
import { useFeatureFlag } from "@posthog/ui/features/feature-flags/useFeatureFlag";
import { usePanelLayoutStore } from "@posthog/ui/features/panels/panelLayoutStore";
import type { ConversationItem } from "@posthog/ui/features/sessions/components/buildConversationItems";
import { ChatMarkdown } from "@posthog/ui/features/sessions/components/chat-thread/ChatMarkdown";
import { ChatThreadFooter } from "@posthog/ui/features/sessions/components/chat-thread/ChatThreadFooter";
import { ChatThreadChromeProvider } from "@posthog/ui/features/sessions/components/chat-thread/chatThreadChrome";
import {
  ToolGroup,
  type ToolGroupItem,
} from "@posthog/ui/features/sessions/components/chat-thread/ToolGroup";
import { GitActionMessage } from "@posthog/ui/features/sessions/components/GitActionMessage";
import { GitActionResult } from "@posthog/ui/features/sessions/components/GitActionResult";
import { mergeConversationItems } from "@posthog/ui/features/sessions/components/mergeConversationItems";
import { extractCanvasInstructions } from "@posthog/ui/features/sessions/components/session-update/canvasInstructions";
import { extractChannelContext } from "@posthog/ui/features/sessions/components/session-update/channelContext";
import { extractCustomInstructions } from "@posthog/ui/features/sessions/components/session-update/customInstructions";
import {
  hasFileMentions,
  MentionChip,
  parseFileMentions,
} from "@posthog/ui/features/sessions/components/session-update/parseFileMentions";
import { SessionUpdateView } from "@posthog/ui/features/sessions/components/session-update/SessionUpdateView";
import { UserShellExecuteView } from "@posthog/ui/features/sessions/components/session-update/UserShellExecuteView";
import { CHAT_CONTENT_MAX_WIDTH } from "@posthog/ui/features/sessions/constants";
import { useConversationItems } from "@posthog/ui/features/sessions/hooks/useConversationItems";
import {
  useOptimisticItemsForTask,
  useSessionForTask,
} from "@posthog/ui/features/sessions/sessionStore";
import type { UserMessageAttachment } from "@posthog/ui/features/sessions/userMessageTypes";
import {
  SessionTaskIdProvider,
  useSessionTaskId,
} from "@posthog/ui/features/sessions/useSessionTaskId";
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
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { ConversationViewProps } from "../ConversationView";

const DIFFS_HIGHLIGHTER_OPTIONS = {
  theme: { dark: "github-dark" as const, light: "github-light" as const },
};

/** A row is either a parsed conversation item or a synthesized group of tool calls. */
type ThreadItem = ConversationItem | ToolGroupItem;

type SessionUpdateItem = Extract<ConversationItem, { type: "session_update" }>;

function isToolCallItem(item: ConversationItem): item is SessionUpdateItem {
  return (
    item.type === "session_update" && item.update.sessionUpdate === "tool_call"
  );
}

/**
 * Session-updates that `SessionUpdateView` always renders as `null`. They produce no row, so they
 * must not break a contiguous tool run.
 */
const INVISIBLE_UPDATES = new Set([
  "user_message_chunk",
  "tool_call_update",
  "plan",
  "available_commands_update",
  "config_option_update",
]);

/**
 * True when an item renders nothing, so it should be transparent to tool grouping. Besides the
 * always-null updates, this covers text chunks the stream emits with empty/whitespace or non-text
 * content (a stray empty `agent_message_chunk` between two tool calls is hidden via `empty:hidden`
 * but would otherwise split the run into two ungrouped markers).
 */
function isInvisibleItem(item: ConversationItem): boolean {
  if (item.type !== "session_update") return false;
  const update = item.update;
  if (INVISIBLE_UPDATES.has(update.sessionUpdate)) return true;
  if (
    update.sessionUpdate === "agent_message_chunk" ||
    update.sessionUpdate === "agent_thought_chunk"
  ) {
    return update.content.type !== "text" || update.content.text.trim() === "";
  }
  return false;
}

/**
 * Collapse each contiguous run of ≥2 tool-call updates into a single `ToolGroupItem`. A run is
 * broken by any *visible* non-tool item (prose, thought, status) so groups follow reading order;
 * invisible updates (see {@link INVISIBLE_UPDATES}) are transparent and don't split a run. A lone
 * tool call passes through untouched — it stays a single marker, matching the legacy thread.
 */
function groupToolRuns(items: ConversationItem[]): ThreadItem[] {
  const out: ThreadItem[] = [];
  // The buffer holds the active run: tool items plus any invisible items interleaved with them.
  let buffer: ConversationItem[] = [];
  let toolCount = 0;

  const flush = () => {
    if (toolCount >= 2) {
      const tools = buffer.filter(isToolCallItem);
      out.push({ type: "tool_group", id: `tool-group-${tools[0].id}`, tools });
    } else {
      out.push(...buffer);
    }
    buffer = [];
    toolCount = 0;
  };

  for (const item of items) {
    if (isToolCallItem(item)) {
      buffer.push(item);
      toolCount++;
    } else if (isInvisibleItem(item)) {
      // Don't break the run; carry it along (it renders nothing wherever it lands).
      buffer.push(item);
    } else {
      flush();
      out.push(item);
    }
  }
  flush();
  return out;
}

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * End-aligned user bubble. The text is clamped to two lines (`max-height: 2lh` + `overflow-hidden`,
 * which — unlike `-webkit-line-clamp` — reliably clamps markdown's block `<p>` children); a "Show
 * more" toggle appears only when the content actually exceeds the clamp. Overflow can't be known
 * from character count (it depends on wrapping width), so we measure `scrollHeight` against the
 * clamped `clientHeight` — which holds even while clamped — and re-measure on resize.
 *
 * A channel's CONTEXT.md and the canvas generation instructions, if injected into this prompt, are
 * collapsed into a clickable `ChatMessageHeader` chip above the bubble (opening the snapshot as a
 * split tab) rather than rendered inline — a project-bluebird feature. The blocks are always stripped
 * (along with the always-on personalization block) so the raw XML never leaks for flag-off viewers.
 * The send timestamp sits in a `ChatMessageFooter` revealed on hover.
 */
function UserBubble({
  content,
  timestamp,
  attachments = [],
}: {
  content: string;
  timestamp?: number;
  attachments?: UserMessageAttachment[];
}) {
  const bluebirdEnabled = useFeatureFlag(
    PROJECT_BLUEBIRD_FLAG,
    import.meta.env.DEV,
  );
  const channelContext = useMemo(
    () => extractChannelContext(content),
    [content],
  );
  const afterChannelContext = channelContext
    ? channelContext.stripped
    : content;
  const canvasInstructions = useMemo(
    () => extractCanvasInstructions(afterChannelContext),
    [afterChannelContext],
  );
  const afterCanvasInstructions = canvasInstructions
    ? canvasInstructions.stripped
    : afterChannelContext;
  const customInstructions = useMemo(
    () => extractCustomInstructions(afterCanvasInstructions),
    [afterCanvasInstructions],
  );
  const displayContent = customInstructions
    ? customInstructions.stripped
    : afterCanvasInstructions;
  const showChannelContextTag = !!channelContext && bluebirdEnabled;
  const showCanvasInstructionsTag = !!canvasInstructions && bluebirdEnabled;
  const showHeaderChips = showChannelContextTag || showCanvasInstructionsTag;
  const taskId = useSessionTaskId();
  const openChannelContextInSplit = usePanelLayoutStore(
    (s) => s.openChannelContextInSplit,
  );
  const openCanvasInstructionsInSplit = usePanelLayoutStore(
    (s) => s.openCanvasInstructionsInSplit,
  );

  const containsFileMentions = hasFileMentions(displayContent);

  const [isExpanded, setIsExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const textRef = useRef<HTMLDivElement>(null);

  // Only meaningful while collapsed: expanding removes the clamp so scrollHeight === clientHeight.
  // We keep the prior result when expanded so the "Show less" trigger stays put.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the message text changes.
  useLayoutEffect(() => {
    if (isExpanded) return;
    const el = textRef.current;
    if (!el) return;
    const measure = () =>
      setIsOverflowing(el.scrollHeight - el.clientHeight > 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [displayContent, isExpanded]);

  return (
    <ChatMessage align="end" className="group">
      <ChatMessageContent>
        {showHeaderChips && (
          <ChatMessageHeader className="flex-wrap gap-1">
            {showChannelContextTag && channelContext && (
              <MentionChip
                icon={<FileText size={12} />}
                label={`${
                  channelContext.mention.name
                    ? `#${channelContext.mention.name} `
                    : ""
                }CONTEXT.md`}
                onClick={
                  taskId
                    ? () =>
                        openChannelContextInSplit(taskId, {
                          channelName: channelContext.mention.name,
                          body: channelContext.mention.body,
                        })
                    : undefined
                }
              />
            )}
            {showCanvasInstructionsTag && canvasInstructions && (
              <MentionChip
                icon={<Scroll size={12} />}
                label="Canvas instructions"
                onClick={
                  taskId
                    ? () =>
                        openCanvasInstructionsInSplit(taskId, {
                          body: canvasInstructions.body,
                        })
                    : undefined
                }
              />
            )}
          </ChatMessageHeader>
        )}
        <ChatBubble align="end" variant="default">
          <ChatBubbleContent>
            <div
              ref={textRef}
              className={cn(
                "[&_p]:my-0",
                !isExpanded && "max-h-[2lh] overflow-hidden",
                // Fade the clamped text out at the bottom so it reads as "continues below". Only
                // when actually overflowing — a short collapsed message shouldn't fade. The mask is
                // paint-only, so it doesn't affect the overflow measurement above.
                !isExpanded &&
                  isOverflowing &&
                  "[mask-image:linear-gradient(to_bottom,black_45%,transparent)]",
              )}
            >
              {containsFileMentions ? (
                parseFileMentions(displayContent)
              ) : (
                <ChatMarkdown content={displayContent} />
              )}
            </div>
            {attachments.length > 0 && !containsFileMentions && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {attachments.map((attachment) => (
                  <MentionChip
                    key={attachment.id}
                    icon={<FileText size={12} />}
                    label={attachment.label}
                  />
                ))}
              </div>
            )}
            {isOverflowing && (
              <button
                type="button"
                onClick={() => setIsExpanded((v) => !v)}
                className="mt-1 flex items-center gap-0.5 text-muted-foreground text-sm hover:text-foreground"
              >
                Show {isExpanded ? "less" : "more"}
                <CaretDown
                  className={cn("size-3", isExpanded && "rotate-180")}
                />
              </button>
            )}
          </ChatBubbleContent>
        </ChatBubble>
        {timestamp != null && (
          <ChatMessageFooter className="opacity-0 transition-opacity group-hover:opacity-100">
            {formatTimestamp(timestamp)}
          </ChatMessageFooter>
        )}
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
  const { currentAnchorId } = useChatMessageScrollerVisibility();
  const { scrollToMessage } = useChatMessageScroller();
  const shouldReduceMotion = useReducedMotion();
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const [offscreen, setOffscreen] = useState(false);
  // Anchor element used only to locate the enclosing scroller/viewport in the DOM.
  const probeRef = useRef<HTMLSpanElement>(null);

  const active = items.find(
    (i): i is Extract<ConversationItem, { type: "user_message" }> =>
      i.id === currentAnchorId && i.type === "user_message",
  );
  const activeId = active?.id ?? null;

  // The engine's `visibleMessageIds` can't be used here: its IntersectionObserver excludes a band of
  // `scrollPreviousItemPeek` px at the viewport top, which is exactly where a freshly-anchored turn
  // message lands — so it reads as "not visible" while plainly on screen. Measure real geometry
  // instead: the message is off-screen only once its bottom scrolls above the viewport top.
  useEffect(() => {
    // No reset when there's no anchor: the overlay render already guards on `active != null`, so a
    // stale `offscreen` is never shown, and a fresh anchor re-measures synchronously below. (Avoids
    // the prop-sync-in-effect pattern react-doctor flags.)
    if (activeId == null) return;
    const viewport = probeRef.current
      ?.closest('[data-slot="chat-message-scroller"]')
      ?.querySelector('[data-slot="chat-message-scroller-viewport"]');
    if (!viewport) return;

    const measure = () => {
      const el = viewport.querySelector(
        `[data-message-id="${CSS.escape(activeId)}"]`,
      );
      if (!el) {
        setOffscreen(false);
        return;
      }
      const messageBottom = el.getBoundingClientRect().bottom;
      const viewportTop = viewport.getBoundingClientRect().top;
      setOffscreen(messageBottom <= viewportTop + 4);
    };

    measure();
    viewport.addEventListener("scroll", measure, { passive: true });
    return () => viewport.removeEventListener("scroll", measure);
  }, [activeId]);

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
    <>
      <span ref={probeRef} className="hidden" aria-hidden="true" />
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
    </>
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
  item: ThreadItem;
  renderItem: (item: ConversationItem) => ReactNode;
}) {
  return (
    <ChatMessageScrollerItem
      messageId={item.id}
      scrollAnchor={item.type === "user_message"}
      className="mx-auto w-full px-2.5 empty:hidden"
      style={{ maxWidth: CHAT_CONTENT_MAX_WIDTH }}
    >
      {item.type === "tool_group" ? (
        <ToolGroup tools={item.tools} />
      ) : item.type === "user_message" ? (
        <UserBubble
          content={item.content}
          timestamp={item.timestamp}
          attachments={item.attachments}
        />
      ) : (
        renderItem(item)
      )}
    </ChatMessageScrollerItem>
  );
});

/** The scroll body, under the Provider so the overlay + scroll-button hooks can read engine state. */
function ThreadScrollBody({
  items,
  rows,
  renderItem,
  footer,
}: {
  items: ConversationItem[];
  rows: ThreadItem[];
  renderItem: (item: ConversationItem) => ReactNode;
  /** Status row (duration / context usage) pinned as the last item in the thread. */
  footer?: ReactNode;
}) {
  // `group/thread` so the footer's hover-reveal (opacity-50 → 100 on group-hover) tracks the thread,
  // mirroring the legacy ConversationView container.
  return (
    <ChatMessageScroller className="group/thread">
      <StickyHeaderOverlay items={items} />
      <ChatMessageScrollerViewport>
        <ChatMessageScrollerContent className="py-4 pb-8" density="default">
          {rows.map((item) => (
            <ThreadRow key={item.id} item={item} renderItem={renderItem} />
          ))}
          {footer && (
            <div
              className="mx-auto w-full px-2.5"
              style={{ maxWidth: CHAT_CONTENT_MAX_WIDTH }}
            >
              {footer}
            </div>
          )}
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
 * to the ChatX primitive, so every tool view is mapped without forking. User messages carry their
 * context chips (`ChatMessageHeader`), file/attachment mentions, and a hover timestamp
 * (`ChatMessageFooter`) — see `UserBubble`.
 *
 * Swapped in behind `settingsStore.useNewChatThread` via `ThreadView`.
 */
export function ChatThread({
  events,
  isPromptPending,
  promptStartedAt,
  repoPath,
  task,
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

  const rows = useMemo<ThreadItem[]>(() => groupToolRuns(items), [items]);

  const renderItem = useCallback(
    (item: ConversationItem) => {
      switch (item.type) {
        // user_message is rendered by ThreadRow via UserBubble (it needs the active-anchor state for
        // the sticky header overlay), so the switch skips it here.
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
          return (
            <ChatMarker variant="separator">
              <ChatMarkerContent>
                {item.interruptReason === "moving_to_worktree"
                  ? "Paused while worktree is focused"
                  : "Interrupted by user"}
              </ChatMarkerContent>
            </ChatMarker>
          );
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
            <ThreadScrollBody
              items={items}
              rows={rows}
              renderItem={renderItem}
              footer={
                <ChatThreadFooter
                  events={events}
                  isPromptPending={isPromptPending}
                  promptStartedAt={promptStartedAt}
                  task={task}
                  taskId={taskId}
                />
              }
            />
          </ChatMessageScrollerProvider>
        </ChatThreadChromeProvider>
      </SessionTaskIdProvider>
    </WorkerPoolContextProvider>
  );
}
