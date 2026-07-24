import {
  CaretDown,
  ChatCircle,
  Check,
  Copy,
  FileText,
  Scroll,
} from "@phosphor-icons/react";
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
  useChatMessageScrollerScrollable,
  useChatMessageScrollerVisibility,
} from "@posthog/quill";
import type { AcpMessage, AgentConversationEvent } from "@posthog/shared";
import { PROJECT_BLUEBIRD_FLAG } from "@posthog/shared";
import type { Task } from "@posthog/shared/domain-types";
import { SHORTCUTS } from "@posthog/ui/features/command/keyboard-shortcuts";
import { useSmoothedText } from "@posthog/ui/features/editor/components/useSmoothedText";
import { useFeatureFlag } from "@posthog/ui/features/feature-flags/useFeatureFlag";
import { usePanelLayoutStore } from "@posthog/ui/features/panels/panelLayoutStore";
import type { ConversationItem } from "@posthog/ui/features/sessions/components/buildConversationItems";
import {
  ChatMarkdown,
  ChatStreamingMarkdown,
} from "@posthog/ui/features/sessions/components/chat-thread/ChatMarkdown";
import { ChatThreadFooter } from "@posthog/ui/features/sessions/components/chat-thread/ChatThreadFooter";
import { ChatThreadChromeProvider } from "@posthog/ui/features/sessions/components/chat-thread/chatThreadChrome";
import {
  PROMPT_RECALL_HINT_KEY,
  type PromptRecallHandler,
} from "@posthog/ui/features/sessions/components/chat-thread/composerPromptRecall";
import { MessageJumpPicker } from "@posthog/ui/features/sessions/components/chat-thread/MessageJumpPicker";
import { ToolGroup } from "@posthog/ui/features/sessions/components/chat-thread/ToolGroup";
import { THREAD_HOTKEY_OPTIONS } from "@posthog/ui/features/sessions/components/chat-thread/threadHotkeys";
import {
  type AgentTurn,
  CHAT_THREAD_VIRTUALIZATION_THRESHOLD,
  completedTurnTimestamp,
  computeStickyAnchor,
  countFlatRows,
  type FlatThreadRow,
  flattenTurnRows,
  type StickyAnchorEntry,
  type StickyAnchorState,
  type ThreadItem,
  type TurnRow,
} from "@posthog/ui/features/sessions/components/chat-thread/threadVirtualization";
import { usePromptRecallSource } from "@posthog/ui/features/sessions/components/chat-thread/usePromptRecallSource";
import { GitActionMessage } from "@posthog/ui/features/sessions/components/GitActionMessage";
import { GitActionResult } from "@posthog/ui/features/sessions/components/GitActionResult";
import { mergeConversationItems } from "@posthog/ui/features/sessions/components/mergeConversationItems";
import { MessageScrollbarRail } from "@posthog/ui/features/sessions/components/scrollbar-rail/MessageScrollbarRail";
import { useMessageRailMarkers } from "@posthog/ui/features/sessions/components/scrollbar-rail/useMessageRailMarkers";
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
import { UserMessageAttachments } from "@posthog/ui/features/sessions/components/UserMessageAttachments";
import { CHAT_CONTENT_MAX_WIDTH } from "@posthog/ui/features/sessions/constants";
import { DIFFS_HIGHLIGHTER_OPTIONS } from "@posthog/ui/features/sessions/diffHighlighterOptions";
import { useAgentConversationItems } from "@posthog/ui/features/sessions/hooks/useAgentConversationItems";
import { useConversationItems } from "@posthog/ui/features/sessions/hooks/useConversationItems";
import {
  useOptimisticItemsForTask,
  useSessionIsCloud,
} from "@posthog/ui/features/sessions/sessionStore";
import type { UserMessageAttachment } from "@posthog/ui/features/sessions/userMessageTypes";
import {
  SessionTaskIdProvider,
  useSessionTaskId,
} from "@posthog/ui/features/sessions/useSessionTaskId";
import { useSettingsStore } from "@posthog/ui/features/settings/settingsStore";
import { SkillButtonActionMessage } from "@posthog/ui/features/skill-buttons/components/SkillButtonActionMessage";
import { useCopy } from "@posthog/ui/primitives/useCopy";
import {
  DIFF_WORKER_FACTORY,
  type DiffWorkerFactory,
} from "@posthog/ui/shell/diffWorkerHost";
import { IconButton, Tooltip } from "@radix-ui/themes";
import { useVirtualizer } from "@tanstack/react-virtual";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  memo,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useHotkeys } from "react-hotkeys-hook";

type SessionUpdateItem = Extract<ConversationItem, { type: "session_update" }>;

/**
 * How far below the viewport top a user message may sit while still counting as the current
 * anchor — shared by the engine (`scrollPreviousItemPeek`) and the virtualized sticky header.
 */
const SCROLL_PREVIOUS_ITEM_PEEK = 64;

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
      out.push({ type: "tool_group", id: tools[0].id, tools });
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

/**
 * Collapse each contiguous run of non-user rows into one {@link AgentTurn}, broken only by a
 * user-initiated row (which stays standalone so it remains the scroll anchor for the sticky header
 * and auto-follow). The turn block renders as a single muted card, tightening the spacing between
 * the agent's successive replies and tool calls.
 */
function groupIntoTurns(rows: ThreadItem[]): TurnRow[] {
  const out: TurnRow[] = [];
  let buffer: ThreadItem[] = [];
  const flush = () => {
    if (buffer.length > 0) {
      out.push({ type: "agent_turn", id: buffer[0].id, items: buffer });
      buffer = [];
    }
  };
  for (const row of rows) {
    // git_action and skill_button_action stand in for the user's message when the prompt was a
    // git operation or a skill button click (see handlePromptRequest) — they open a turn just
    // like a user message, so they break the agent card too rather than render inside it as if
    // they were agent output. Same boundary set as the legacy view's buildThreadGroups.
    if (
      row.type === "user_message" ||
      row.type === "git_action" ||
      row.type === "skill_button_action"
    ) {
      flush();
      out.push(row);
    } else {
      buffer.push(row);
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
 * Hover-revealed timestamp rendered right-aligned under agent-side content (the end-aligned user
 * bubble keeps its own right-aligned footer). Sits inside a `group` container so it fades in only
 * while that container is hovered. Shown once per completed agent turn (under the turn card)
 * rather than on every message — per-row it was too noisy.
 */
function RowTimestamp({ timestamp }: { timestamp?: number }) {
  if (timestamp == null) return null;
  return (
    <ChatMessageFooter className="mt-2 items-center justify-end gap-1 pl-0 opacity-0 transition-opacity group-hover:opacity-100">
      <span className="text-muted-foreground">
        {formatTimestamp(timestamp)}
      </span>
    </ChatMessageFooter>
  );
}

/**
 * End-aligned user bubble. The text is clamped to five lines (`max-height: 5lh` + `overflow-hidden`,
 * which — unlike `-webkit-line-clamp` — reliably clamps markdown's block `<p>` children); a "Show
 * more" toggle appears only when the content actually exceeds the clamp, so short messages never
 * grow a toggle. Overflow can't be known
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
  keyboardFocused = false,
}: {
  content: string;
  timestamp?: number;
  attachments?: UserMessageAttachment[];
  keyboardFocused?: boolean;
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
      <ChatMessageContent className="gap-1 pr-9">
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
        <ChatBubble
          align="end"
          variant="default"
          className={cn(
            "rounded-lg ring-(--gray-11) ring-0 ring-inset transition-shadow",
            keyboardFocused && "ring-[3px]",
          )}
        >
          <ChatBubbleContent>
            <div
              ref={textRef}
              className={cn(
                "[&_p]:my-0",
                !isExpanded && "max-h-[5lh] overflow-hidden",
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
              <div className="mt-1.5">
                <UserMessageAttachments attachments={attachments} />
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
      <MessageCopyButton
        value={displayContent}
        revealClassName="group-hover:opacity-100"
      />
    </ChatMessage>
  );
}

/**
 * Copy icon that floats into a message's right rail on hover. The hover-group qualifier differs by
 * message type (`group` for user bubbles, `group/msg` for agent prose), so callers pass their own
 * `revealClassName` (the `group-hover*:opacity-100` utility).
 */
function MessageCopyButton({
  value,
  revealClassName,
}: {
  value: string;
  revealClassName: string;
}) {
  const { copied, copy } = useCopy();
  return (
    <Tooltip content={copied ? "Copied!" : "Copy message"}>
      <IconButton
        size="1"
        variant="ghost"
        color={copied ? "green" : "gray"}
        onClick={() => copy(value)}
        className={cn(
          "absolute top-1 right-1 cursor-pointer opacity-0 transition-opacity",
          revealClassName,
        )}
        aria-label="Copy message"
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </IconButton>
    </Tooltip>
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
          <StickyHeaderJumpButton onClick={() => dismiss(active.id)} />
        )}
      </AnimatePresence>
    </>
  );
}

/**
 * The floating "jump to your message" pill both sticky-header variants render. Must be a direct
 * child of an `AnimatePresence` so its exit animation plays.
 */
function StickyHeaderJumpButton({ onClick }: { onClick: () => void }) {
  const shouldReduceMotion = useReducedMotion();
  return (
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
          onClick={onClick}
          className="pointer-events-auto rounded-full bg-background shadow-md"
        >
          <ChatCircle />
        </Button>
      </div>
    </motion.div>
  );
}

/**
 * Virtualized-mode sticky header. The engine's visibility state can't power it here — unmounted
 * rows aren't observed — so the parent derives the anchor from the virtualizer's measurements
 * (see {@link computeStickyAnchor}) and passes the result down. Dismissal semantics match
 * {@link StickyHeaderOverlay}: hide immediately on click, return once the message has been back
 * on screen.
 */
function VirtualStickyHeader({
  items,
  anchorId,
  offscreen,
  onJump,
}: {
  items: ConversationItem[];
  anchorId: string | null;
  offscreen: boolean;
  onJump: (id: string) => void;
}) {
  const [dismissedId, setDismissedId] = useState<string | null>(null);

  // Clear a dismissal the moment the anchor is back on screen, so the header can return for the
  // next offscreen episode. Render-phase adjustment, not an effect — the cleared state must not
  // flash through a committed frame.
  if (!offscreen && dismissedId !== null) {
    setDismissedId(null);
  }

  const active = items.find(
    (i): i is Extract<ConversationItem, { type: "user_message" }> =>
      i.id === anchorId && i.type === "user_message",
  );

  return (
    <AnimatePresence>
      {active != null && offscreen && active.id !== dismissedId && (
        <StickyHeaderJumpButton
          onClick={() => {
            setDismissedId(active.id);
            onJump(active.id);
          }}
        />
      )}
    </AnimatePresence>
  );
}

/**
 * Start-aligned assistant prose bubble. Streamed tokens arrive in bursts; `useSmoothedText` reveals
 * them at a steady character rate so the text reads as even typing (text present on mount shows
 * immediately, so completed messages render in full with no replay).
 *
 * While streaming, the smoothed reveal re-renders every animation frame, so the markdown goes
 * through `ChatStreamingMarkdown` (block-split: each frame re-parses only the tail block). Once the
 * turn completes it swaps to a single full `ChatMarkdown` parse.
 */
const AgentProse = memo(function AgentProse({
  text,
  isStreaming = false,
}: {
  text: string;
  isStreaming?: boolean;
}) {
  const smoothed = useSmoothedText(text);

  return (
    <ChatMessage align="start" className="group/msg">
      <ChatMessageContent className="gap-1 pr-9">
        <ChatBubble variant="ghost">
          <ChatBubbleContent>
            {isStreaming ? (
              <ChatStreamingMarkdown content={smoothed} />
            ) : (
              <ChatMarkdown content={text} />
            )}
          </ChatBubbleContent>
        </ChatBubble>
      </ChatMessageContent>
      {isStreaming ? null : (
        <MessageCopyButton
          value={text}
          revealClassName="group-hover/msg:opacity-100"
        />
      )}
    </ChatMessage>
  );
});

/** Renders a single thread item's body (no scroller wrapper), reused for standalone rows and for
 * each item inside an agent-turn card. `isTrailing` marks the turn's last item — a trailing tool
 * group of a streaming turn may still grow, so its label stays "Using …" between tool calls. */
function ThreadItemBody({
  item,
  renderItem,
  isTrailing = false,
  keyboardFocused = false,
}: {
  item: ThreadItem;
  renderItem: (item: ConversationItem) => ReactNode;
  isTrailing?: boolean;
  keyboardFocused?: boolean;
}) {
  if (item.type === "tool_group") {
    const context = item.tools[0]?.turnContext;
    const turnStreaming =
      !!context && !context.turnComplete && !context.turnCancelled;
    return (
      <ToolGroup
        tools={item.tools}
        mayStillGrow={isTrailing && turnStreaming}
      />
    );
  }
  if (item.type === "user_message") {
    return (
      <UserBubble
        content={item.content}
        timestamp={item.timestamp}
        attachments={item.attachments}
        keyboardFocused={keyboardFocused}
      />
    );
  }
  return <>{renderItem(item)}</>;
}

/**
 * One transcript row. Memoized and scroll-state-free, so rows never re-render while scrolling — the
 * non-virtualized thread stays cheap. The pinned header is the separate overlay, not the rows.
 *
 * An {@link AgentTurn} renders as a single muted card wrapping its items with tight spacing; a user
 * message stays a standalone anchored row.
 */
const ThreadRow = memo(function ThreadRow({
  item,
  renderItem,
  keyboardFocused,
}: {
  item: TurnRow;
  renderItem: (item: ConversationItem) => ReactNode;
  keyboardFocused?: boolean;
}) {
  if (item.type === "agent_turn") {
    return (
      <ChatMessageScrollerItem
        messageId={item.id}
        scrollAnchor={false}
        className="group mx-auto w-full px-4 empty:hidden"
        style={{ maxWidth: CHAT_CONTENT_MAX_WIDTH }}
      >
        <div className="flex flex-col gap-4 empty:hidden">
          {item.items.map((sub, i) => (
            // The scroller item's own content-visibility works at whole-turn granularity — a
            // large turn (diffs, charts, dozens of tools) would render wholesale as soon as the
            // card nears the viewport. Nesting content-visibility per sub-item keeps layout +
            // paint bounded to the viewport-sized slice while scrolling; `auto` remembers each
            // row's real size after first render so the scrollbar stays stable.
            <div
              key={sub.id}
              className="[contain-intrinsic-size:auto_2rem] [content-visibility:auto] empty:hidden"
            >
              <ThreadItemBody
                item={sub}
                renderItem={renderItem}
                isTrailing={i === item.items.length - 1}
              />
            </div>
          ))}
        </div>
        <RowTimestamp timestamp={completedTurnTimestamp(item)} />
      </ChatMessageScrollerItem>
    );
  }
  return (
    <ChatMessageScrollerItem
      messageId={item.id}
      scrollAnchor={item.type === "user_message"}
      className="mx-auto w-full px-2.5 py-1 empty:hidden"
      style={{ maxWidth: CHAT_CONTENT_MAX_WIDTH }}
    >
      <ThreadItemBody
        item={item}
        renderItem={renderItem}
        keyboardFocused={keyboardFocused}
      />
    </ChatMessageScrollerItem>
  );
});

/**
 * Keeps the view pinned to the bottom from prompt submit until the user scrolls away.
 *
 * The engine's own follow mode isn't enough on its own:
 * - It only re-engages within `scrollEdgeThreshold` of the exact bottom, so a submit from anywhere
 *   higher would leave the new prompt (and the reply) below the fold. Scrolling to the end on
 *   submit also flips the engine back into `following-bottom`.
 * - Each engine autoscroll is guarded by a 180ms grace window; a large streamed block (heavy
 *   markdown render) can jank past it, making the engine observe "content below the fold while not
 *   autoscrolling" and silently demote itself to `free-scrolling` mid-reply. While armed, any
 *   commit that leaves content below the fold re-issues `scrollToEnd` to recapture follow.
 *
 * User scroll intent (wheel, touch, pointer, keys — same signals the engine listens to) disarms
 * the pin; the next submit or the scroll-to-bottom button re-engages following.
 */
function ThreadAutoFollow({ items }: { items: ConversationItem[] }) {
  const { scrollToEnd } = useChatMessageScroller();
  const { end } = useChatMessageScrollerScrollable();
  const lastItem = items.at(-1);
  const userMessageCount = useMemo(
    () =>
      items.reduce((n, item) => (item.type === "user_message" ? n + 1 : n), 0),
    [items],
  );
  const prevCountRef = useRef(userMessageCount);
  const armedRef = useRef(false);
  const probeRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const previous = prevCountRef.current;
    prevCountRef.current = userMessageCount;
    if (previous === 0 || userMessageCount <= previous) return;
    if (lastItem?.type !== "user_message") return;
    armedRef.current = true;
    scrollToEnd({ behavior: "auto" });
  }, [userMessageCount, lastItem, scrollToEnd]);

  useEffect(() => {
    const viewport = probeRef.current
      ?.closest('[data-slot="chat-message-scroller"]')
      ?.querySelector('[data-slot="chat-message-scroller-viewport"]');
    if (!viewport) return;
    const disarm = () => {
      armedRef.current = false;
    };
    const events = ["wheel", "touchmove", "pointerdown", "keydown"] as const;
    for (const event of events) {
      viewport.addEventListener(event, disarm, { passive: true });
    }
    return () => {
      for (const event of events) {
        viewport.removeEventListener(event, disarm);
      }
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-check on every streamed change — `end` alone doesn't re-notify while it stays true across commits.
  useEffect(() => {
    if (armedRef.current && end) {
      scrollToEnd({ behavior: "auto" });
    }
  }, [items, end, scrollToEnd]);

  return <span ref={probeRef} className="hidden" aria-hidden="true" />;
}

/**
 * Keyboard message navigation (Alt/Option+Up/Down) and the Cmd/Ctrl+J jump picker. Rendered inside
 * `ChatMessageScrollerProvider` so it can call `scrollToMessage` from the engine — the same primitive
 * `StickyHeaderOverlay` uses to jump back to the anchored turn.
 */
function ThreadKeyboardNav({
  items,
  jumpPickerOpen,
  setJumpPickerOpen,
  keyboardFocusedMessageId,
  setKeyboardFocusedMessageId,
  promptRecallRef,
  jumpToMessage,
}: {
  items: ConversationItem[];
  jumpPickerOpen: boolean;
  setJumpPickerOpen: (value: boolean | ((prev: boolean) => boolean)) => void;
  keyboardFocusedMessageId: string | null;
  setKeyboardFocusedMessageId: (id: string | null) => void;
  promptRecallRef?: RefObject<PromptRecallHandler | null>;
  /**
   * Override for the engine's `scrollToMessage`. The virtualized body supplies one that jumps by
   * row index — the engine can only scroll to mounted rows, and a windowed thread keeps most rows
   * unmounted.
   */
  jumpToMessage?: (id: string) => void;
}) {
  const { scrollToMessage } = useChatMessageScroller();
  const jump = jumpToMessage ?? scrollToMessage;

  const userMessages = useMemo(
    () =>
      items
        .filter(
          (item): item is Extract<ConversationItem, { type: "user_message" }> =>
            item.type === "user_message",
        )
        .map((item) => ({ id: item.id, content: item.content })),
    [items],
  );
  const userMessageIds = useMemo(
    () => userMessages.map((message) => message.id),
    [userMessages],
  );

  useHotkeys(
    SHORTCUTS.MESSAGE_JUMP,
    () => setJumpPickerOpen((prev) => !prev),
    THREAD_HOTKEY_OPTIONS,
  );

  const handleNavigateMessage = useCallback(
    (direction: -1 | 1) => {
      if (userMessageIds.length === 0) return;

      const currentIndex = keyboardFocusedMessageId
        ? userMessageIds.indexOf(keyboardFocusedMessageId)
        : -1;

      const nextIndex =
        currentIndex === -1
          ? direction > 0
            ? 0
            : userMessageIds.length - 1
          : Math.max(
              0,
              Math.min(userMessageIds.length - 1, currentIndex + direction),
            );

      const nextId = userMessageIds[nextIndex];
      if (!nextId) return;

      useSettingsStore.getState().markHintLearned(PROMPT_RECALL_HINT_KEY);
      setKeyboardFocusedMessageId(nextId);
      jump(nextId);
    },
    [
      keyboardFocusedMessageId,
      userMessageIds,
      setKeyboardFocusedMessageId,
      jump,
    ],
  );

  useHotkeys(
    SHORTCUTS.MESSAGE_PREV,
    () => handleNavigateMessage(-1),
    THREAD_HOTKEY_OPTIONS,
  );

  useHotkeys(
    SHORTCUTS.MESSAGE_NEXT,
    () => handleNavigateMessage(1),
    THREAD_HOTKEY_OPTIONS,
  );

  usePromptRecallSource(userMessages, promptRecallRef);

  const handleJumpToMessage = useCallback(
    (id: string) => {
      setKeyboardFocusedMessageId(id);
      jump(id);
    },
    [jump, setKeyboardFocusedMessageId],
  );

  return (
    <MessageJumpPicker
      open={jumpPickerOpen}
      onOpenChange={setJumpPickerOpen}
      items={items}
      onJumpToMessage={handleJumpToMessage}
    />
  );
}

/**
 * Scroll state the non-virtualized body continuously records so the virtualized body can resume
 * from roughly the same place when the thread crosses the virtualization threshold mid-session.
 */
type ThreadScrollResume = { atBottom: boolean; scrollTop: number };

/**
 * Keeps {@link ThreadScrollResume} current while the non-virtualized body is mounted. At-bottom
 * comes from the engine's scrollable state (`end` is true while content extends below the fold);
 * scrollTop comes from a passive listener on the engine viewport, located via the same hidden
 * probe pattern the other engine-adjacent helpers use. Writes go to a ref — this must not
 * re-render on scroll.
 */
function ThreadScrollStateRecorder({
  stateRef,
}: {
  stateRef: RefObject<ThreadScrollResume>;
}) {
  const { end } = useChatMessageScrollerScrollable();
  const probeRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    stateRef.current = { ...stateRef.current, atBottom: !end };
  }, [end, stateRef]);

  useEffect(() => {
    const viewport = probeRef.current
      ?.closest('[data-slot="chat-message-scroller"]')
      ?.querySelector('[data-slot="chat-message-scroller-viewport"]');
    if (!viewport) return;
    const record = () => {
      stateRef.current = { ...stateRef.current, scrollTop: viewport.scrollTop };
    };
    record();
    viewport.addEventListener("scroll", record, { passive: true });
    return () => viewport.removeEventListener("scroll", record);
  }, [stateRef]);

  return <span ref={probeRef} className="hidden" aria-hidden="true" />;
}

/** The scroll body, under the Provider so the overlay + scroll-button hooks can read engine state. */
function ThreadScrollBody({
  items,
  rows,
  renderItem,
  footer,
  keyboardFocusedMessageId,
  onUserInteract,
  resumeStateRef,
}: {
  items: ConversationItem[];
  rows: TurnRow[];
  renderItem: (item: ConversationItem) => ReactNode;
  /** Status row (duration / context usage) pinned as the last item in the thread. */
  footer?: ReactNode;
  keyboardFocusedMessageId?: string | null;
  /** Clears keyboard-focused message state on any pointer interaction with the thread. */
  onUserInteract?: () => void;
  /** Continuously updated so the virtualized body can take over mid-session (see {@link ThreadScrollResume}). */
  resumeStateRef: RefObject<ThreadScrollResume>;
}) {
  const keyedRows = useMemo(() => {
    let userTurn = 0;
    return rows.map((item) => ({
      item,
      key: item.type === "user_message" ? `user-turn-${userTurn++}` : item.id,
    }));
  }, [rows]);

  // `group/thread` so the footer's hover-reveal (opacity-50 → 100 on group-hover) tracks the thread,
  // mirroring the legacy ConversationView container.
  return (
    <ChatMessageScroller
      className="group/thread"
      onPointerDownCapture={onUserInteract}
    >
      <StickyHeaderOverlay items={items} />
      <ThreadAutoFollow items={items} />
      <ThreadScrollStateRecorder stateRef={resumeStateRef} />
      <ThreadScrollbarRail
        items={items}
        keyboardFocusedMessageId={keyboardFocusedMessageId}
      />
      <ChatMessageScrollerViewport>
        <ChatMessageScrollerContent
          className="gap-4 py-4 pb-8"
          density="default"
        >
          {keyedRows.map(({ item, key }) => (
            <ThreadRow
              key={key}
              item={item}
              renderItem={renderItem}
              keyboardFocused={item.id === keyboardFocusedMessageId}
            />
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
 * Scrollbar marker rail for the (non-virtualized) ChatThread. One darker marker
 * per user message, positioned by that message's offset within the scroller;
 * click jumps to it (`scrollToMessage`), hover shows the first few words.
 *
 * Locates the quill scroller elements at runtime via a hidden probe (the same
 * `closest('[data-slot="chat-message-scroller"]')` pattern `StickyHeaderOverlay`
 * and `ThreadAutoFollow` use), since they're owned by quill and not handed to us
 * as refs. The viewport is the scroll element; the inner `ChatMessageScrollerContent`
 * is the content element (rows are its children, so their offsets within it are
 * scroll-invariant).
 */
function ThreadScrollbarRail({
  items,
  keyboardFocusedMessageId,
}: {
  items: ConversationItem[];
  keyboardFocusedMessageId?: string | null;
}) {
  const { scrollToMessage } = useChatMessageScroller();
  const probeRef = useRef<HTMLSpanElement>(null);
  const [els, setEls] = useState<{
    scrollEl: HTMLElement | null;
    contentEl: HTMLElement | null;
  }>({ scrollEl: null, contentEl: null });

  useLayoutEffect(() => {
    const resolve = (): {
      scrollEl: HTMLElement | null;
      contentEl: HTMLElement | null;
    } => {
      const scroller = probeRef.current?.closest(
        '[data-slot="chat-message-scroller"]',
      );
      return {
        scrollEl:
          (scroller?.querySelector(
            '[data-slot="chat-message-scroller-viewport"]',
          ) as HTMLElement | null) ?? null,
        contentEl:
          (scroller?.querySelector(
            '[data-slot="chat-message-scroller-content"]',
          ) as HTMLElement | null) ?? null,
      };
    };
    const found = resolve();
    setEls((prev) =>
      prev.scrollEl === found.scrollEl && prev.contentEl === found.contentEl
        ? prev
        : found,
    );
    if (!found.scrollEl || !found.contentEl) {
      // Re-resolve once the scroller's inner elements have mounted.
      const raf = requestAnimationFrame(() => {
        const again = resolve();
        setEls((prev) =>
          prev.scrollEl === again.scrollEl && prev.contentEl === again.contentEl
            ? prev
            : again,
        );
      });
      return () => cancelAnimationFrame(raf);
    }
    return;
  }, []);

  const userMessages = useMemo(
    () =>
      items
        .map((item, index) =>
          item.type === "user_message"
            ? { id: item.id, content: item.content, index }
            : null,
        )
        .filter(
          (x): x is { id: string; content: string; index: number } => x != null,
        ),
    [items],
  );

  const railMarkers = useMessageRailMarkers({
    contentEl: els.contentEl,
    scrollEl: els.scrollEl,
    userMessages,
    onJump: (id) => scrollToMessage(id),
    activeId: keyboardFocusedMessageId,
    rowAttribute: "data-message-id",
  });

  return (
    <>
      <span ref={probeRef} className="hidden" aria-hidden="true" />
      <MessageScrollbarRail markers={railMarkers} />
    </>
  );
}

// Windowing geometry for the virtualized body. Estimate/overscan/drift values match the legacy
// VirtualizedList, whose tuning these rows share (same item mix, same measure-then-settle churn).
const VIRTUAL_ESTIMATED_ROW_SIZE = 80;
const VIRTUAL_OVERSCAN = 12;
/** Matches the Provider's `scrollEdgeThreshold` so "at bottom" agrees between engine and windowing. */
const VIRTUAL_AT_BOTTOM_THRESHOLD = 100;
// A real upward drift, not a 1-frame measure transient: the DOM bottom sits
// this far below the viewport. Well above any single append's measure gap.
const VIRTUAL_FAR_DRIFT_THRESHOLD = 400;
/** Top of the virtual coordinate space — stands in for the non-virtualized content's `py-4`. */
const VIRTUAL_PADDING_START = 16;

const EMPTY_FLAT_ROWS: FlatThreadRow[] = [];

/** Imperative surface the virtualized body hands to the nav layer rendered outside it. */
interface VirtualJumpApi {
  jumpToMessage: (id: string) => void;
}

/**
 * One windowed row. Memoized against the row's *contents* rather than the row wrapper object —
 * `flattenTurnRows` rebuilds wrappers on every streamed chunk, but the underlying conversation
 * items are reused by reference for completed turns, so mounted rows outside the streaming tail
 * skip re-rendering their markdown/diffs.
 *
 * `content-visibility` is forced off (the quill item class sets `auto`): the virtualizer already
 * bounds the mounted set, and overscan rows must lay out for `measureElement` to size them before
 * they scroll into view — skipped rendering would feed it the placeholder intrinsic size instead.
 */
const FlatRowView = memo(
  function FlatRowView({
    row,
    renderItem,
    keyboardFocused,
  }: {
    row: FlatThreadRow;
    renderItem: (item: ConversationItem) => ReactNode;
    keyboardFocused: boolean;
  }) {
    const { item } = row;
    return (
      <ChatMessageScrollerItem
        messageId={item.id}
        scrollAnchor={false}
        className={cn(
          // pb-4 stands in for the non-virtualized content's inter-row gap-4; an empty row
          // collapses entirely (display:none hides the padding too), matching how flex gap
          // skips hidden children there.
          "mx-auto w-full pb-4 [content-visibility:visible] empty:hidden",
          row.inTurn ? "group px-4" : "px-2.5 pt-1",
        )}
        style={{ maxWidth: CHAT_CONTENT_MAX_WIDTH }}
      >
        <ThreadItemBody
          item={item}
          renderItem={renderItem}
          isTrailing={row.isTrailingInTurn}
          keyboardFocused={keyboardFocused}
        />
        {row.turnTimestamp != null && (
          <RowTimestamp timestamp={row.turnTimestamp} />
        )}
      </ChatMessageScrollerItem>
    );
  },
  (prev, next) =>
    prev.row.item === next.row.item &&
    prev.row.key === next.row.key &&
    prev.row.inTurn === next.row.inTurn &&
    prev.row.isTrailingInTurn === next.row.isTrailingInTurn &&
    prev.row.turnTimestamp === next.row.turnTimestamp &&
    prev.renderItem === next.renderItem &&
    prev.keyboardFocused === next.keyboardFocused,
);

/**
 * Windowed scroll body for long threads, following the upstream MessageScroller guidance:
 * virtualization lives outside the primitive — the quill viewport stays the scroll element and a
 * `@tanstack/react-virtual` virtualizer owns the rows inside `ChatMessageScrollerContent`.
 *
 * The engine still provides the chrome that only needs scroll geometry (the scroll-to-bottom
 * button and edge state read real element measurements), while everything item-based gets a
 * windowed implementation here: follow-bottom via `anchorTo: "end"` + `followOnAppend` (the
 * legacy `VirtualizedList` recipe), message jumps via `scrollToIndex`, the sticky header via
 * {@link computeStickyAnchor} over the virtualizer's measurements, and the scrollbar rail via its
 * existing interpolate-unmounted-rows path.
 */
function VirtualThreadScrollBody({
  items,
  flatRows,
  renderItem,
  footer,
  keyboardFocusedMessageId,
  onUserInteract,
  jumpApiRef,
  resumeStateRef,
}: {
  items: ConversationItem[];
  flatRows: FlatThreadRow[];
  renderItem: (item: ConversationItem) => ReactNode;
  /** Status row (duration / context usage) pinned as the last item in the thread. */
  footer?: ReactNode;
  keyboardFocusedMessageId?: string | null;
  /** Clears keyboard-focused message state on any pointer interaction with the thread. */
  onUserInteract?: () => void;
  /** Filled with this body's jump implementation for the nav layer rendered outside it. */
  jumpApiRef: RefObject<VirtualJumpApi | null>;
  /** Scroll state recorded by the non-virtualized body, consumed once when this body takes over. */
  resumeStateRef: RefObject<ThreadScrollResume>;
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [viewportEl, setViewportEl] = useState<HTMLDivElement | null>(null);
  const [contentEl, setContentEl] = useState<HTMLDivElement | null>(null);
  const footerRef = useRef<HTMLDivElement | null>(null);
  const initializedRef = useRef(false);
  // Seeded from the handoff state so a mid-session flip while reading above the fold doesn't
  // immediately re-pin to the bottom.
  const isAtBottomRef = useRef(resumeStateRef.current?.atBottom ?? true);
  const lastScrollTopRef = useRef(0);
  const settleRafRef = useRef<number | null>(null);

  // The footer is real trailing content, NOT a fake virtual row — as a virtual row its constant
  // key would always be last and permanently kill tanstack's followOnAppend. Its height is
  // reserved as `paddingEnd` instead so the virtual coordinate space includes it (the
  // VirtualizedList recipe).
  const hasFooter = footer != null;
  const [footerHeight, setFooterHeight] = useState(0);
  useLayoutEffect(() => {
    const el = footerRef.current;
    const measure = () => {
      const height = hasFooter && el ? el.offsetHeight : 0;
      setFooterHeight((prev) => (prev === height ? prev : height));
    };
    measure();
    if (!hasFooter || !el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasFooter]);

  const virtualizer = useVirtualizer({
    count: flatRows.length,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => VIRTUAL_ESTIMATED_ROW_SIZE,
    overscan: VIRTUAL_OVERSCAN,
    anchorTo: "end",
    followOnAppend: true,
    scrollEndThreshold: VIRTUAL_AT_BOTTOM_THRESHOLD,
    paddingStart: VIRTUAL_PADDING_START,
    paddingEnd: footerHeight,
    getItemKey: (index) => flatRows[index]?.key ?? index,
  });

  const cancelSettle = useCallback(() => {
    if (settleRafRef.current !== null) {
      cancelAnimationFrame(settleRafRef.current);
      settleRafRef.current = null;
    }
  }, []);

  // Pin to the true bottom, retrying across frames while rows measure taller than the estimate.
  const settleAtEnd = useCallback(() => {
    cancelSettle();
    isAtBottomRef.current = true;
    let attempts = 0;
    const step = () => {
      virtualizer.scrollToEnd();
      if (virtualizer.isAtEnd(VIRTUAL_AT_BOTTOM_THRESHOLD) || ++attempts > 12) {
        settleRafRef.current = null;
        return;
      }
      settleRafRef.current = requestAnimationFrame(step);
    };
    step();
  }, [virtualizer, cancelSettle]);

  // Jump to a row, re-issuing across a few frames until the target offset stops drifting as the
  // rows around it measure.
  const settleToIndex = useCallback(
    (index: number) => {
      cancelSettle();
      isAtBottomRef.current = false;
      virtualizer.scrollToIndex(index, { align: "start" });
      let attempts = 0;
      const step = () => {
        settleRafRef.current = null;
        const viewport = viewportRef.current;
        const target = virtualizer.getOffsetForIndex(index, "start")?.[0];
        if (!viewport || target == null) return;
        const maxScroll = Math.max(
          0,
          viewport.scrollHeight - viewport.clientHeight,
        );
        if (
          Math.abs(viewport.scrollTop - Math.min(target, maxScroll)) <= 1 ||
          ++attempts > 8
        ) {
          return;
        }
        virtualizer.scrollToIndex(index, { align: "start" });
        settleRafRef.current = requestAnimationFrame(step);
      };
      settleRafRef.current = requestAnimationFrame(step);
    },
    [virtualizer, cancelSettle],
  );

  useEffect(() => cancelSettle, [cancelSettle]);

  const userRows = useMemo(() => {
    const result: Array<{ id: string; rowIndex: number; content: string }> = [];
    flatRows.forEach((row, index) => {
      if (row.item.type === "user_message") {
        result.push({
          id: row.item.id,
          rowIndex: index,
          content: row.item.content,
        });
      }
    });
    return result;
  }, [flatRows]);

  const rowIndexByMessageId = useMemo(() => {
    const map = new Map<string, number>();
    flatRows.forEach((row, index) => {
      map.set(row.item.id, index);
    });
    return map;
  }, [flatRows]);

  const jumpToMessage = useCallback(
    (id: string) => {
      const index = rowIndexByMessageId.get(id);
      if (index != null) settleToIndex(index);
    },
    [rowIndexByMessageId, settleToIndex],
  );

  useEffect(() => {
    jumpApiRef.current = { jumpToMessage };
    return () => {
      jumpApiRef.current = null;
    };
  }, [jumpApiRef, jumpToMessage]);

  // Initial position: resume near where the non-virtualized body left off (offsets are estimates
  // until rows measure, so the landing is approximate and self-corrects), or settle at the bottom.
  useLayoutEffect(() => {
    if (initializedRef.current || flatRows.length === 0) return;
    initializedRef.current = true;
    const resume = resumeStateRef.current;
    if (resume && !resume.atBottom) {
      virtualizer.scrollToOffset(resume.scrollTop);
      return;
    }
    settleAtEnd();
  }, [flatRows.length, settleAtEnd, virtualizer, resumeStateRef]);

  // Sticky-header anchor, derived from the virtualizer's measurements (estimated for rows that
  // have never mounted; exact once measured). Recomputed at most once per frame on scroll and on
  // content growth.
  const [stickyState, setStickyState] = useState<StickyAnchorState>({
    anchorId: null,
    offscreen: false,
  });
  const recomputeSticky = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const cache = virtualizer.measurementsCache;
    const entries: StickyAnchorEntry[] = userRows.map((user) => {
      const measured = cache[user.rowIndex];
      const start =
        measured?.start ?? user.rowIndex * VIRTUAL_ESTIMATED_ROW_SIZE;
      const end = measured?.end ?? start + VIRTUAL_ESTIMATED_ROW_SIZE;
      return { id: user.id, start, end };
    });
    const next = computeStickyAnchor(
      entries,
      viewport.scrollTop,
      SCROLL_PREVIOUS_ITEM_PEEK,
    );
    setStickyState((prev) =>
      prev.anchorId === next.anchorId && prev.offscreen === next.offscreen
        ? prev
        : next,
    );
  }, [userRows, virtualizer]);

  const stickyFrameRef = useRef<number | null>(null);
  const scheduleStickyRecompute = useCallback(() => {
    if (stickyFrameRef.current != null) return;
    stickyFrameRef.current = requestAnimationFrame(() => {
      stickyFrameRef.current = null;
      recomputeSticky();
    });
  }, [recomputeSticky]);
  useEffect(() => {
    scheduleStickyRecompute();
    return () => {
      if (stickyFrameRef.current != null) {
        cancelAnimationFrame(stickyFrameRef.current);
        stickyFrameRef.current = null;
      }
    };
  }, [scheduleStickyRecompute]);

  const handleScroll = useCallback(() => {
    const el = viewportRef.current;
    const scrollTop = el?.scrollTop ?? 0;
    // Tolerate sub-pixel jitter; only a real upward move counts as leaving end.
    const scrolledUp = scrollTop < lastScrollTopRef.current - 1;
    lastScrollTopRef.current = scrollTop;

    const atEnd = virtualizer.isAtEnd(VIRTUAL_AT_BOTTOM_THRESHOLD);
    // Genuine far drift (not a 1-frame measure transient): the DOM bottom sits well below the
    // viewport, so follow can't get silently stuck mid-thread.
    const farFromEnd = el
      ? el.scrollHeight - el.clientHeight - scrollTop >
        VIRTUAL_FAR_DRIFT_THRESHOLD
      : false;
    // Hysteresis: each append measures taller than the estimate, so for one frame isAtEnd reads
    // false before followOnAppend/anchorTo re-pin. Re-arm at the end; only clear on a real
    // upward scroll or a genuine drift.
    if (atEnd) {
      isAtBottomRef.current = true;
    } else if (scrolledUp || farFromEnd) {
      isAtBottomRef.current = false;
    }
    scheduleStickyRecompute();
  }, [virtualizer, scheduleStickyRecompute]);

  const totalSize = virtualizer.getTotalSize();

  // Anything that changes the virtual height while following has to re-pin to the new bottom:
  // rows remeasuring past the estimate, late async content (highlighting, diffs) growing rows,
  // and the footer resize feeding paddingEnd. totalSize is the one value that moves for all of
  // them. Layout effect so the re-pin lands before paint.
  // biome-ignore lint/correctness/useExhaustiveDependencies: totalSize is the trigger, not a body dependency
  useLayoutEffect(() => {
    if (!isAtBottomRef.current) return;
    virtualizer.scrollToEnd();
  }, [totalSize, virtualizer]);

  // A prompt submitted from anywhere re-engages follow (same trigger ThreadAutoFollow uses in the
  // non-virtualized body): settleAtEnd flips isAtBottomRef, and the totalSize re-pin plus
  // followOnAppend keep the reply pinned from there.
  const lastItem = items.at(-1);
  const userMessageCount = useMemo(
    () =>
      items.reduce((n, item) => (item.type === "user_message" ? n + 1 : n), 0),
    [items],
  );
  const prevUserCountRef = useRef(userMessageCount);
  useLayoutEffect(() => {
    const previous = prevUserCountRef.current;
    prevUserCountRef.current = userMessageCount;
    if (previous === 0 || userMessageCount <= previous) return;
    if (lastItem?.type !== "user_message") return;
    settleAtEnd();
  }, [userMessageCount, lastItem, settleAtEnd]);

  // Coming back to a backgrounded tab: ResizeObserver callbacks were throttled, so re-settle if
  // we were following (the legacy view does the same).
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden && isAtBottomRef.current) settleAtEnd();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [settleAtEnd]);

  const railUserMessages = useMemo(
    () =>
      userRows.map((user) => ({
        id: user.id,
        content: user.content,
        index: user.rowIndex,
      })),
    [userRows],
  );
  const railMarkers = useMessageRailMarkers({
    contentEl,
    scrollEl: viewportEl,
    userMessages: railUserMessages,
    onJump: jumpToMessage,
    activeId: keyboardFocusedMessageId,
    rowAttribute: "data-message-id",
  });

  return (
    <ChatMessageScroller
      className="group/thread"
      onPointerDownCapture={onUserInteract}
    >
      <VirtualStickyHeader
        items={items}
        anchorId={stickyState.anchorId}
        offscreen={stickyState.offscreen}
        onJump={jumpToMessage}
      />
      <MessageScrollbarRail markers={railMarkers} />
      <ChatMessageScrollerViewport
        ref={(el: HTMLDivElement | null) => {
          viewportRef.current = el;
          setViewportEl(el);
        }}
        onScroll={handleScroll}
      >
        {/* `block` overrides the content's flex+gap layout — spacing moves into the rows
            (pb-4) and the virtual paddings, so translateY offsets are the whole layout. */}
        <ChatMessageScrollerContent className="block" density="default">
          <div
            ref={setContentEl}
            className="relative w-full"
            style={{ height: totalSize }}
          >
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const row = flatRows[virtualItem.index];
              if (!row) return null;
              return (
                <div
                  key={virtualItem.key}
                  ref={virtualizer.measureElement}
                  data-index={virtualItem.index}
                  className="absolute top-0 left-0 w-full"
                  style={{ transform: `translateY(${virtualItem.start}px)` }}
                >
                  <FlatRowView
                    row={row}
                    renderItem={renderItem}
                    keyboardFocused={row.item.id === keyboardFocusedMessageId}
                  />
                </div>
              );
            })}
            {/* Footer occupies the reserved paddingEnd region at the very bottom of the virtual
                space, so the DOM bottom == the virtual end. */}
            {hasFooter && (
              <div ref={footerRef} className="absolute bottom-0 left-0 w-full">
                <div
                  className="mx-auto w-full px-2.5 pb-8"
                  style={{ maxWidth: CHAT_CONTENT_MAX_WIDTH }}
                >
                  {footer}
                </div>
              </div>
            )}
          </div>
        </ChatMessageScrollerContent>
      </ChatMessageScrollerViewport>
      <ChatMessageScrollerButton
        onClick={(event: ReactMouseEvent) => {
          // The engine's own scroll-to-end targets the current scrollHeight, which is an
          // estimate until every row between here and the bottom has measured — settle instead.
          event.preventDefault();
          settleAtEnd();
        }}
      />
    </ChatMessageScroller>
  );
}

/**
 * Thread renderer built on the ChatX (quill) primitives.
 *
 * Reuses the existing parse pipeline (`useConversationItems`) and the non-virtualized
 * `ChatMessageScroller` (`content-visibility: auto`). User + assistant turns render through
 * `ChatMessage`/`ChatBubble` (end-aligned filled / start-aligned ghost) with our own `ChatMarkdown`.
 * Tool calls render as `ChatMarker` — `ChatThreadChromeProvider` flips the shared `ToolRow` chrome
 * to the ChatX primitive, so every tool view is mapped without forking. User messages carry their
 * context chips (`ChatMessageHeader`), file/attachment mentions, and a hover timestamp
 * (`ChatMessageFooter`) — see `UserBubble`.
 */
interface SharedChatThreadProps {
  isPromptPending: boolean | null;
  promptStartedAt?: number | null;
  promptRecallRef?: RefObject<PromptRecallHandler | null>;
  repoPath?: string | null;
  task?: Task;
  taskId?: string;
}

export interface ChatThreadProps extends SharedChatThreadProps {
  events: AgentConversationEvent[];
}

export interface AcpChatThreadProps extends SharedChatThreadProps {
  events: AcpMessage[];
}

export function ChatThread({ events, ...props }: ChatThreadProps) {
  const { items } = useAgentConversationItems(events, props.isPromptPending);

  return (
    <ChatThreadRenderer
      {...props}
      conversationItems={items}
      footerEvents={[]}
    />
  );
}

export function AcpChatThread({ events, ...props }: AcpChatThreadProps) {
  const showDebugLogs = useSettingsStore((state) => state.debugLogsCloudRuns);
  const { items } = useConversationItems(events, props.isPromptPending, {
    showDebugLogs,
  });

  return (
    <ChatThreadRenderer
      {...props}
      conversationItems={items}
      footerEvents={events}
    />
  );
}

interface ChatThreadRendererProps extends SharedChatThreadProps {
  conversationItems: ConversationItem[];
  footerEvents: AcpMessage[];
}

function ChatThreadRenderer({
  conversationItems,
  footerEvents,
  isPromptPending,
  promptStartedAt,
  repoPath,
  task,
  taskId,
  promptRecallRef,
}: ChatThreadRendererProps) {
  const diffWorkerFactory = useService<DiffWorkerFactory>(DIFF_WORKER_FACTORY);
  const diffsPoolOptions = useMemo(
    () => ({
      workerFactory: () => diffWorkerFactory(),
      totalASTLRUCacheSize: 200,
    }),
    [diffWorkerFactory],
  );

  const optimisticItems = useOptimisticItemsForTask(taskId);
  const isCloud = useSessionIsCloud(taskId);

  const items = useMemo<ConversationItem[]>(
    () =>
      mergeConversationItems({ conversationItems, optimisticItems, isCloud }),
    [conversationItems, optimisticItems, isCloud],
  );

  const rows = useMemo<TurnRow[]>(
    () => groupIntoTurns(groupToolRuns(items)),
    [items],
  );

  // Virtualization ratchet: past the threshold the thread switches to the windowed body and
  // stays there for the life of this mount (see CHAT_THREAD_VIRTUALIZATION_THRESHOLD). Long
  // sessions start virtualized from the first render; a live session flips once mid-stream,
  // resuming from the scroll state the non-virtualized body recorded.
  const flatCount = useMemo(() => countFlatRows(rows), [rows]);
  const [virtualized, setVirtualized] = useState(
    () => flatCount > CHAT_THREAD_VIRTUALIZATION_THRESHOLD,
  );
  if (!virtualized && flatCount > CHAT_THREAD_VIRTUALIZATION_THRESHOLD) {
    setVirtualized(true);
  }
  const flatRows = useMemo(
    () => (virtualized ? flattenTurnRows(rows) : EMPTY_FLAT_ROWS),
    [virtualized, rows],
  );
  const virtualJumpApiRef = useRef<VirtualJumpApi | null>(null);
  const threadResumeRef = useRef<ThreadScrollResume>({
    atBottom: true,
    scrollTop: 0,
  });
  const jumpToMessage = useMemo(
    () =>
      virtualized
        ? (id: string) => virtualJumpApiRef.current?.jumpToMessage(id)
        : undefined,
    [virtualized],
  );

  const [jumpPickerOpen, setJumpPickerOpen] = useState(false);
  const [keyboardFocusedMessageId, setKeyboardFocusedMessageId] = useState<
    string | null
  >(null);
  const clearKeyboardFocus = useCallback(() => {
    setKeyboardFocusedMessageId(null);
  }, []);

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
              <AgentProse
                text={update.content.text}
                isStreaming={!item.turnContext.turnComplete}
              />
            );
          }
          const rendered = (
            <SessionUpdateView
              item={item.update}
              toolCalls={item.turnContext.toolCalls}
              childItems={item.turnContext.childItems}
              turnCancelled={item.turnContext.turnCancelled}
              turnComplete={item.turnContext.turnComplete}
              thoughtComplete={item.thoughtComplete}
            />
          );
          return rendered;
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

  const footer = (
    <ChatThreadFooter
      events={footerEvents}
      isPromptPending={isPromptPending}
      promptStartedAt={promptStartedAt}
      task={task}
      taskId={taskId}
    />
  );

  return (
    <WorkerPoolContextProvider
      poolOptions={diffsPoolOptions}
      highlighterOptions={DIFFS_HIGHLIGHTER_OPTIONS}
    >
      <SessionTaskIdProvider taskId={taskId}>
        <ChatThreadChromeProvider value={true}>
          <ChatMessageScrollerProvider
            // The windowed body owns following itself (anchorTo end + followOnAppend) — the
            // engine's own follow would fight it, so it only auto-scrolls when non-virtualized.
            autoScroll={!virtualized}
            defaultScrollPosition="end"
            // Default is 8px: with the thread's bottom padding you're rarely that close, so
            // auto-follow ("following-bottom") would disengage on any stray trackpad wheel and
            // never re-engage. Within this band the engine recaptures follow on the next content
            // change; deliberate upward flicks travel past it and stay free-scrolling.
            scrollEdgeThreshold={100}
            scrollPreviousItemPeek={SCROLL_PREVIOUS_ITEM_PEEK}
          >
            {virtualized ? (
              <VirtualThreadScrollBody
                items={items}
                flatRows={flatRows}
                renderItem={renderItem}
                keyboardFocusedMessageId={keyboardFocusedMessageId}
                onUserInteract={clearKeyboardFocus}
                footer={footer}
                jumpApiRef={virtualJumpApiRef}
                resumeStateRef={threadResumeRef}
              />
            ) : (
              <ThreadScrollBody
                items={items}
                rows={rows}
                renderItem={renderItem}
                keyboardFocusedMessageId={keyboardFocusedMessageId}
                onUserInteract={clearKeyboardFocus}
                footer={footer}
                resumeStateRef={threadResumeRef}
              />
            )}
            <ThreadKeyboardNav
              items={items}
              jumpPickerOpen={jumpPickerOpen}
              setJumpPickerOpen={setJumpPickerOpen}
              keyboardFocusedMessageId={keyboardFocusedMessageId}
              setKeyboardFocusedMessageId={setKeyboardFocusedMessageId}
              promptRecallRef={promptRecallRef}
              jumpToMessage={jumpToMessage}
            />
          </ChatMessageScrollerProvider>
        </ChatThreadChromeProvider>
      </SessionTaskIdProvider>
    </WorkerPoolContextProvider>
  );
}
