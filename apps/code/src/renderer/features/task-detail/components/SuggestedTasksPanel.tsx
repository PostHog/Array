import { useInboxReportSelectionStore } from "@features/inbox/stores/inboxReportSelectionStore";
import { SetupScanFeed } from "@features/setup/components/SetupScanFeed";
import { useSetupStore } from "@features/setup/stores/setupStore";
import type { DiscoveredTask } from "@features/setup/types";
import { ArrowRight, Lightning, MagnifyingGlass } from "@phosphor-icons/react";
import { Flex, Text } from "@radix-ui/themes";
import { useNavigationStore } from "@stores/navigationStore";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { SuggestedTaskCard } from "./SuggestedTaskCard";

const VISIBLE_LIMIT = 3;
const DEFAULT_LOG_LINES = 4;

// Rough heights (px) used to drop cards / log lines that wouldn't fit below
// the editor.
const TOP_MARGIN = 12;
const HEADER_HEIGHT = 18;
const GAP = 8;
const SCAN_PILL_HEIGHT = 52;
const CARD_HEIGHT = 56;
const SEE_MORE_HEIGHT = 24;
const BOTTOM_PADDING = 56;
const LOG_LINE_HEIGHT = 24;
const LOG_FEED_PADDING = 16;

interface SuggestedTasksPanelProps {
  onSelect: (task: DiscoveredTask) => void;
}

export function SuggestedTasksPanel({ onSelect }: SuggestedTasksPanelProps) {
  const discoveredTasks = useSetupStore((s) => s.discoveredTasks);
  const discoveryStatus = useSetupStore((s) => s.discoveryStatus);
  const enricherStatus = useSetupStore((s) => s.enricherStatus);
  const discoveryFeed = useSetupStore((s) => s.discoveryFeed);
  const removeDiscoveredTask = useSetupStore((s) => s.removeDiscoveredTask);
  const selectDiscoveredTask = useSetupStore((s) => s.selectDiscoveredTask);
  const navigateToInbox = useNavigationStore((s) => s.navigateToInbox);

  const containerRef = useRef<HTMLDivElement>(null);
  const [availableHeight, setAvailableHeight] = useState<number>(() =>
    typeof window === "undefined"
      ? Number.POSITIVE_INFINITY
      : window.innerHeight,
  );

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const measure = () => {
      const rect = el.getBoundingClientRect();
      setAvailableHeight(window.innerHeight - rect.top);
    };

    measure();
    const observer = new ResizeObserver(measure);
    const parent = el.parentElement;
    if (parent) observer.observe(parent);
    observer.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  const handleDismiss = useCallback(
    (task: DiscoveredTask) => {
      removeDiscoveredTask(task.id);
    },
    [removeDiscoveredTask],
  );

  const handleViewDetails = useCallback(
    (task: DiscoveredTask) => {
      useInboxReportSelectionStore.getState().clearSelection();
      selectDiscoveredTask(task.id);
      navigateToInbox();
    },
    [selectDiscoveredTask, navigateToInbox],
  );

  const isEnricherRunning = enricherStatus === "running";
  const isDiscoveryRunning = discoveryStatus === "running";

  const hasTasks = discoveredTasks.length > 0;

  if (!hasTasks && !isEnricherRunning && !isDiscoveryRunning) return null;

  const totalTasks = discoveredTasks.length;
  const desiredVisible = Math.min(totalTasks, VISIBLE_LIMIT);
  const discoveryFeedHasEntries = discoveryFeed.recentEntries.length > 0;

  // Sum the sections that will be rendered, including inter-section gaps.
  const measureTotalHeight = (cardCount: number, logLines: number): number => {
    const sections: number[] = [];
    if (hasTasks) {
      sections.push(HEADER_HEIGHT);
    }
    if (cardCount > 0) {
      sections.push(cardCount * CARD_HEIGHT + Math.max(0, cardCount - 1) * GAP);
    }
    if (totalTasks - cardCount > 0) {
      sections.push(SEE_MORE_HEIGHT);
    }
    if (isEnricherRunning) {
      sections.push(SCAN_PILL_HEIGHT);
    }
    if (isDiscoveryRunning) {
      let h = SCAN_PILL_HEIGHT;
      if (logLines > 0 && discoveryFeedHasEntries) {
        h += LOG_FEED_PADDING + logLines * LOG_LINE_HEIGHT;
      }
      sections.push(h);
    }
    const sectionsTotal = sections.reduce((a, b) => a + b, 0);
    const gapsTotal = Math.max(0, sections.length - 1) * GAP;
    return TOP_MARGIN + sectionsTotal + gapsTotal + BOTTOM_PADDING;
  };

  // Drop log lines before cards: log lines are decorative, cards are the
  // actionable items.
  let visibleCount = desiredVisible;
  let logLines = isDiscoveryRunning ? DEFAULT_LOG_LINES : 0;
  if (Number.isFinite(availableHeight)) {
    while (measureTotalHeight(visibleCount, logLines) > availableHeight) {
      if (logLines > 0) logLines -= 1;
      else if (visibleCount > 0) visibleCount -= 1;
      else break;
    }
  }

  const visibleTasks = discoveredTasks.slice(0, visibleCount);
  const hiddenCount = totalTasks - visibleTasks.length;

  const fadeMotion = {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
    transition: { duration: 0.15 },
  };

  return (
    <div ref={containerRef} className="mt-3 flex flex-col gap-2">
      {hasTasks && (
        <Text size="1" weight="medium" className="px-2.5 text-(--gray-11)">
          Suggestions
        </Text>
      )}
      <AnimatePresence initial={false} mode="popLayout">
        {visibleTasks.map((task, index) => (
          <SuggestedTaskCard
            key={task.id}
            task={task}
            index={index}
            onSelect={onSelect}
            onDismiss={handleDismiss}
            onViewDetails={handleViewDetails}
          />
        ))}
        {hiddenCount > 0 && (
          <motion.button
            key="see-more"
            layout
            type="button"
            onClick={navigateToInbox}
            {...fadeMotion}
            className="cursor-pointer self-end rounded-md px-1.5 py-0.5 text-(--gray-11) hover:text-(--gray-12)"
          >
            <Flex align="center" gap="1">
              <Text size="1" weight="medium">
                See {hiddenCount} more in Inbox
              </Text>
              <ArrowRight size={12} weight="bold" />
            </Flex>
          </motion.button>
        )}
        {isEnricherRunning && (
          <motion.div key="enricher" layout {...fadeMotion}>
            <SetupScanFeed
              label="Quick wins"
              icon={Lightning}
              color="amber"
              currentTool={null}
              activeLabelOverride="Checking your PostHog setup…"
              recentEntries={[]}
              isDone={false}
            />
          </motion.div>
        )}
        {isDiscoveryRunning && (
          <motion.div key="discovery" layout {...fadeMotion}>
            <SetupScanFeed
              label="Analyzing your codebase"
              description="Looking for bugs, dead code, and improvements"
              icon={MagnifyingGlass}
              color="orange"
              currentTool={discoveryFeed.currentTool}
              recentEntries={discoveryFeed.recentEntries}
              isDone={false}
              maxLogLines={logLines}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
