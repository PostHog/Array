import { ChatCircle } from "@phosphor-icons/react";
import {
  Button,
  useChatMessageScroller,
  useChatMessageScrollerVisibility,
} from "@posthog/quill";
import type { ConversationItem } from "@posthog/ui/features/sessions/components/buildConversationItems";
import { CHAT_CONTENT_MAX_WIDTH } from "@posthog/ui/features/sessions/constants";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

type UserMessageItem = Extract<ConversationItem, { type: "user_message" }>;

function findUserMessage(
  items: ConversationItem[],
  id: string | null,
): UserMessageItem | undefined {
  if (id == null) return undefined;
  return items.find(
    (item): item is UserMessageItem =>
      item.id === id && item.type === "user_message",
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
 * "Fake sticky" header. A real `position: sticky` row can't hand off in this flat list (every row
 * shares one containing block, so they'd pile at the top) and sticking causes reflow. Instead we
 * overlay a single header, out of flow, pinned over the viewport top — showing the current turn's
 * user message (the engine's anchor) once the real one has scrolled off. Click to scroll back to it.
 *
 * Only this small component subscribes to the engine's per-scroll visibility state, so the rows
 * themselves never re-render on scroll.
 */
export function StickyHeaderOverlay({ items }: { items: ConversationItem[] }) {
  const { currentAnchorId } = useChatMessageScrollerVisibility();
  const { scrollToMessage } = useChatMessageScroller();
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const [offscreen, setOffscreen] = useState(false);
  // Anchor element used only to locate the enclosing scroller/viewport in the DOM.
  const probeRef = useRef<HTMLSpanElement>(null);

  const active = findUserMessage(items, currentAnchorId);
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
  // Render-phase adjustment rather than an effect, matching {@link VirtualStickyHeader}.
  if (!offscreen && dismissedId !== null) {
    setDismissedId(null);
  }

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
 * Windowed-mode sticky header. The engine's visibility state can't power it here — unmounted rows
 * aren't observed — so the body derives the anchor from the virtualizer's measurements (see
 * `computeStickyAnchor`) and passes the result down. Dismissal semantics match
 * {@link StickyHeaderOverlay}: hide immediately on click, return once the message has been back on
 * screen.
 */
export function VirtualStickyHeader({
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

  const active = findUserMessage(items, anchorId);

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
