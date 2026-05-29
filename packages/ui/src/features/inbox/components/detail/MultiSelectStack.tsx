import type { SignalReport } from "@posthog/shared/domain-types";
import { ReportCardContent } from "@posthog/ui/features/inbox/components/utils/ReportCardContent";
import { Flex, Text } from "@radix-ui/themes";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useState } from "react";

interface MultiSelectStackProps {
  reports: SignalReport[];
  onClearSelection: () => void;
}

/** Maximum number of cards to render in the visual stack. */
const MAX_VISIBLE_CARDS = 5;

/** Vertical gap between cards when collapsed (just peeking). */
const COLLAPSED_GAP = 14;
/** Vertical gap between cards when fanned open on hover. */
const FANNED_GAP = 120;

export function MultiSelectStack({
  reports,
  onClearSelection,
}: MultiSelectStackProps) {
  const visibleReports = reports.slice(0, MAX_VISIBLE_CARDS);
  const overflowCount = reports.length - MAX_VISIBLE_CARDS;

  // Index of the card being hovered. null = collapsed stack.
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const handleCardHover = useCallback((index: number) => {
    setHoveredIndex(index);
  }, []);

  const handleStackLeave = useCallback(() => {
    setHoveredIndex(null);
  }, []);

  const cardCount = visibleReports.length;
  const collapsedHeight =
    130 + (cardCount > 1 ? (cardCount - 1) * COLLAPSED_GAP : 0);
  // When hovering, one card jumps out by FANNED_GAP instead of COLLAPSED_GAP
  const hoveredHeight = collapsedHeight + (FANNED_GAP - COLLAPSED_GAP);
  // Top card (last index) is already fully visible — no need to expand
  const isHoveringNonTopCard =
    hoveredIndex !== null && hoveredIndex < cardCount - 1;
  const stackHeight = isHoveringNonTopCard ? hoveredHeight : collapsedHeight;

  return (
    <Flex
      direction="column"
      align="center"
      justify="center"
      gap="4"
      className="min-h-0 flex-1 overflow-auto p-[32px]"
    >
      {/* ── Stacked cards ──────────────────────────────────────────── */}
      <motion.div
        animate={{ height: stackHeight }}
        transition={{ type: "spring", stiffness: 800, damping: 45 }}
        onMouseLeave={handleStackLeave}
        className="relative w-full max-w-[400px]"
      >
        <AnimatePresence mode="popLayout">
          {visibleReports.map((report, i) => {
            const distanceFromFront = cardCount - 1 - i;

            // Don't fan when hovering the topmost card — it's already visible
            const hoveredDistFromFront =
              hoveredIndex !== null && hoveredIndex < cardCount - 1
                ? cardCount - 1 - hoveredIndex
                : null;

            // Hovered card offset = collapsed cards in front + one fanned jump.
            // Cards in front stay collapsed. Cards behind collapse behind the hovered card.
            let yOffset: number;
            if (hoveredDistFromFront !== null) {
              // The hovered card's position: cards in front at COLLAPSED_GAP + one FANNED_GAP
              const hoveredY =
                (hoveredDistFromFront > 0
                  ? (hoveredDistFromFront - 1) * COLLAPSED_GAP + FANNED_GAP
                  : 0) * -1;

              if (distanceFromFront === hoveredDistFromFront) {
                yOffset = hoveredY;
              } else if (distanceFromFront < hoveredDistFromFront) {
                // In front of hovered card — collapsed at the front
                yOffset = distanceFromFront * -COLLAPSED_GAP;
              } else {
                // Behind the hovered card — collapsed behind it
                const behindBy = distanceFromFront - hoveredDistFromFront;
                yOffset = hoveredY + behindBy * -COLLAPSED_GAP;
              }
            } else {
              yOffset = distanceFromFront * -COLLAPSED_GAP;
            }

            const scale = 1 - distanceFromFront * 0.025;

            return (
              <motion.div
                key={report.id}
                layout
                initial={{ opacity: 0, y: 24, scale: 0.92 }}
                animate={{
                  opacity: 1,
                  y: yOffset,
                  scale,
                  transition: {
                    type: "spring",
                    stiffness: 800,
                    damping: 45,
                  },
                }}
                exit={{
                  opacity: 0,
                  y: 24,
                  scale: 0.88,
                  transition: { duration: 0.1 },
                }}
                onMouseEnter={() => handleCardHover(i)}
                style={{
                  zIndex: i,
                  transformOrigin: "bottom center",
                }}
                className="absolute right-0 bottom-0 left-0 cursor-default"
              >
                <div
                  className="rounded-lg border border-gray-5 bg-gray-2 px-4 py-3 shadow-sm"
                  style={{ backdropFilter: "blur(8px)" }}
                >
                  <ReportCardContent report={report} showMeta />
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </motion.div>

      {/* ── Summary text ───────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.1 }}
      >
        <Flex direction="column" align="center" gap="1">
          <Text color="gray" className="font-medium text-sm">
            {reports.length} reports selected
          </Text>
          {overflowCount > 0 && (
            <Text color="gray" className="text-[11px]">
              +{overflowCount} more not shown
            </Text>
          )}
          <button
            type="button"
            onClick={onClearSelection}
            className="mt-1 cursor-pointer text-[12px] text-gray-10 underline decoration-gray-6 underline-offset-2 transition-colors hover:text-gray-12"
          >
            Clear selection
          </button>
        </Flex>
      </motion.div>
    </Flex>
  );
}
