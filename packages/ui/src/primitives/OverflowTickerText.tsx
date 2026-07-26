import { cn } from "@posthog/quill";
import { useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

const TICKER_SPEED_PX_PER_SECOND = 50;
const TICKER_FADE_PX = 24;

export function OverflowTickerText({
  reveal,
  className,
  children,
}: {
  reveal: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const contentRef = useRef<HTMLSpanElement>(null);
  const [overflowPx, setOverflowPx] = useState(0);
  const [reachedEnd, setReachedEnd] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return;
    const measure = () => {
      setOverflowPx(Math.max(0, container.scrollWidth - container.clientWidth));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!reveal) setReachedEnd(false);
  }, [reveal]);

  const prefersReducedMotion = useReducedMotion();
  const isTicking = reveal && overflowPx > 0;
  const showsEnd = reachedEnd || (isTicking && prefersReducedMotion);

  return (
    <span
      ref={containerRef}
      className={cn("min-w-0 overflow-hidden whitespace-nowrap", className)}
      style={{
        maskImage:
          overflowPx === 0
            ? undefined
            : isTicking
              ? showsEnd
                ? `linear-gradient(to right, transparent, black ${TICKER_FADE_PX}px)`
                : `linear-gradient(to right, transparent, black ${TICKER_FADE_PX}px, black calc(100% - ${TICKER_FADE_PX}px), transparent)`
              : `linear-gradient(to right, black calc(100% - ${TICKER_FADE_PX}px), transparent)`,
      }}
    >
      <span
        ref={contentRef}
        className="inline-block"
        onTransitionEnd={(e) => {
          if (e.propertyName === "transform") setReachedEnd(true);
        }}
        style={
          isTicking
            ? {
                transform: `translateX(-${overflowPx}px)`,
                transitionProperty: prefersReducedMotion ? "none" : "transform",
                transitionTimingFunction: "linear",
                transitionDuration: `${overflowPx / TICKER_SPEED_PX_PER_SECOND}s`,
              }
            : { transform: "translateX(0)", transitionProperty: "none" }
        }
      >
        {children}
      </span>
    </span>
  );
}
