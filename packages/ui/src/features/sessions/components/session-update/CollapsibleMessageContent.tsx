import { CaretDown, CaretUp } from "@phosphor-icons/react";
import { Box } from "@radix-ui/themes";
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

const COLLAPSED_MAX_HEIGHT = 160;

interface CollapsibleMessageContentProps {
  children: ReactNode;
  className?: string;
  /** Extra classes for the inner content box (e.g. per-caller typography). */
  contentClassName?: string;
  /** Color the bottom fade blends into — match the caller's background. */
  fadeColor?: string;
  style?: CSSProperties;
}

export function CollapsibleMessageContent({
  children,
  className,
  contentClassName,
  fadeColor = "var(--gray-2)",
  style,
}: CollapsibleMessageContentProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = contentRef.current;
    if (el) {
      setIsOverflowing(el.scrollHeight > COLLAPSED_MAX_HEIGHT);
    }
  }, []);

  return (
    <Box className={className} style={style}>
      <Box
        ref={contentRef}
        className={`relative overflow-hidden font-medium text-[13px] [&>*:last-child]:mb-0 ${contentClassName ?? ""}`}
        style={
          !isExpanded && isOverflowing
            ? { maxHeight: COLLAPSED_MAX_HEIGHT }
            : undefined
        }
      >
        {children}
        {!isExpanded && isOverflowing && (
          <Box
            className="pointer-events-none absolute inset-x-0 bottom-0 h-12"
            style={{
              background: `linear-gradient(transparent, ${fadeColor})`,
            }}
          />
        )}
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
