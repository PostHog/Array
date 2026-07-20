import { ChatStream, cn } from "@posthog/quill";
import { type ReactNode, useCallback } from "react";

/**
 * The framed, capped window a thread row's content sits in — an agent's turn in
 * the thread panel, a mention's body in Activity. Both are "something long the
 * agent said", so both are read the same way: a box tall enough to show the
 * shape of it, scrolled for the rest, rather than a wall that pushes the next
 * row off screen.
 *
 * The frame is this wrapper, not the ChatStream inside it. ChatStream masks its
 * own top and bottom edges to fade the content as it scrolls, and that mask
 * would eat a border drawn on the same element — the frame would dissolve at
 * the corners exactly when there's more to read. Keeping them separate lets the
 * content fade while the box stays put. (ChatStream expects this: it "brings no
 * chrome and no rail — let the container frame it".)
 *
 * With `onClick` the frame is the click target and highlights on hover. The
 * stream still scrolls inside it; only a drag started on the scrollbar itself
 * would land on the button, which is the same trade every clickable card makes.
 */
export function ThreadScrollBody({
  pinned = false,
  onClick,
  className,
  children,
}: {
  /** Follow live output. Off for anything already finished. */
  pinned?: boolean;
  /** Makes the frame pressable — e.g. an agent turn opening its task. */
  onClick?: () => void;
  className?: string;
  children: ReactNode;
}) {
  // Open on the last line, not the first: the end of a turn is what the reader
  // wants, and scrolling up for the rest is the natural way back.
  //
  // A ref callback is the whole of it — it lands once, on mount, before paint,
  // with no state, no effect and nothing to re-run. The obvious CSS answer,
  // `flex-direction: column-reverse`, does start at the bottom but flips the
  // scroll origin negative, and ChatStream's fade logic reads raw `scrollTop`:
  // under the flip its two flags stick at constant values and the fades stop
  // tracking the content. Keeping the normal origin keeps them honest.
  //
  // While pinned, ChatStream is already following the newest line, and hands
  // over parked at the bottom when it unpins — so this is only the mount case.
  const scrollToEnd = useCallback((frame: HTMLElement | null) => {
    const stream = frame?.querySelector<HTMLElement>('[data-slot="stream"]');
    if (stream) stream.scrollTop = stream.scrollHeight;
  }, []);

  const frame = cn(
    "w-full rounded-md border border-border bg-muted px-2 py-1.5 text-left",
    onClick && "cursor-default hover:border-primary/50 hover:bg-fill-hover",
    className,
  );
  const stream = <ChatStream pinned={pinned}>{children}</ChatStream>;

  return onClick ? (
    <button ref={scrollToEnd} type="button" onClick={onClick} className={frame}>
      {stream}
    </button>
  ) : (
    <div ref={scrollToEnd} className={frame}>
      {stream}
    </div>
  );
}
