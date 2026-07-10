import { CaretDown, CaretUp } from "@phosphor-icons/react";
import { cn } from "@posthog/quill";
import { Box } from "@radix-ui/themes";
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useRef,
  useState,
} from "react";

const COLLAPSED_MAX_HEIGHT = 160;

interface CollapsibleMessageContentProps {
  children: ReactNode;
  className?: string;
  /** Extra classes for the inner content box (e.g. per-caller typography). */
  contentClassName?: string;
  style?: CSSProperties;
}

export function CollapsibleMessageContent({
  children,
  className,
  contentClassName,
  style,
}: CollapsibleMessageContentProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const observerRef = useRef<ResizeObserver | null>(null);

  // Measure via a callback ref (React's recommended way to read a DOM node into
  // state) rather than a mount effect, so it runs before paint — no flash of
  // unclamped content. The ResizeObserver keeps the check correct when content
  // reflows or, for feed rows inside a `content-visibility: auto` container,
  // lays out lazily only once scrolled into view. scrollHeight is the true
  // content height regardless of the collapsed max-height, so the check holds
  // in both the collapsed and expanded states.
  const measureRef = useCallback((el: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!el) return;
    const measure = () =>
      setIsOverflowing(el.scrollHeight > COLLAPSED_MAX_HEIGHT);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    observerRef.current = observer;
  }, []);

  return (
    <Box className={className} style={style}>
      {/* When collapsed + overflowing, clamp the height and fade the *text* out
          at the bottom with a paint-only mask (same technique as the chat
          thread's user bubble). A mask fades only painted pixels, so — unlike an
          overlaid colored gradient — it needs no background color to blend into
          and never paints a full-width band past ragged text. Being paint-only,
          it also leaves the scrollHeight measurement above untouched. */}
      <Box
        ref={measureRef}
        className={cn(
          "overflow-hidden [&>*:last-child]:mb-0",
          !isExpanded &&
            isOverflowing &&
            "[mask-image:linear-gradient(to_bottom,black_45%,transparent)]",
          contentClassName,
        )}
        style={
          !isExpanded && isOverflowing
            ? { maxHeight: COLLAPSED_MAX_HEIGHT }
            : undefined
        }
      >
        {children}
      </Box>
      {isOverflowing && (
        <button
          type="button"
          onClick={() => setIsExpanded((prev) => !prev)}
          className="mt-1 inline-flex items-center gap-1 text-[12px] text-accent-11 hover:text-accent-12"
        >
          {isExpanded ? (
            <>
              <CaretUp size={12} />
              Show less
            </>
          ) : (
            <>
              <CaretDown size={12} />
              Show more
            </>
          )}
        </button>
      )}
    </Box>
  );
}
