import type { DiscoveredTask } from "@features/setup/types";
import {
  CATEGORY_CONFIG,
  FALLBACK_CATEGORY_CONFIG,
} from "@features/setup/utils/categoryConfig";
import { ArrowSquareOut, X } from "@phosphor-icons/react";
import { Flex, Text, Tooltip } from "@radix-ui/themes";
import { motion } from "framer-motion";

export interface SuggestedTaskCardProps {
  task: DiscoveredTask;
  index: number;
  onSelect: (task: DiscoveredTask) => void;
  onDismiss: (task: DiscoveredTask) => void;
  onViewDetails: (task: DiscoveredTask) => void;
}

export function SuggestedTaskCard({
  task,
  index,
  onSelect,
  onDismiss,
  onViewDetails,
}: SuggestedTaskCardProps) {
  const config = CATEGORY_CONFIG[task.category] ?? FALLBACK_CATEGORY_CONFIG;
  const TaskIcon = config.icon;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{
        opacity: 0,
        y: -4,
        transition: { duration: 0.12, delay: 0 },
      }}
      transition={{
        duration: 0.18,
        delay: index * 0.04,
        layout: { type: "spring", damping: 25, stiffness: 300 },
      }}
      className="group relative"
    >
      <button
        onClick={() => onSelect(task)}
        type="button"
        className="flex w-full cursor-pointer items-start gap-2.5 rounded-xl border border-(--gray-a3) bg-(--color-panel-solid) px-2.5 py-2 text-left shadow-[0_1px_3px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] transition-[border-color,box-shadow] hover:border-(--card-hover-border) hover:shadow-[0_2px_8px_rgba(0,0,0,0.06),0_1px_3px_rgba(0,0,0,0.04)]"
        style={
          {
            "--card-hover-border": `var(--${config.color}-6)`,
          } as React.CSSProperties
        }
      >
        <Flex
          align="center"
          justify="center"
          className="h-6 w-6 shrink-0 rounded-md"
          style={{ backgroundColor: `var(--${config.color}-3)` }}
        >
          <TaskIcon
            size={14}
            weight="duotone"
            color={`var(--${config.color}-9)`}
          />
        </Flex>
        <Flex direction="column" gap="1" className="min-w-0 flex-1">
          <Text
            size="1"
            weight="medium"
            className="min-w-0 truncate text-(--gray-12)"
          >
            {task.title}
          </Text>
          <Text
            size="1"
            className="line-clamp-1 text-(--gray-11) leading-normal"
          >
            {task.description}
          </Text>
        </Flex>
      </button>
      <Flex
        align="center"
        gap="1"
        className="pointer-events-none absolute top-2 right-2 opacity-0 transition-opacity group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100"
      >
        <Tooltip content="View details">
          <button
            type="button"
            aria-label="View details"
            onClick={(e) => {
              e.stopPropagation();
              onViewDetails(task);
            }}
            className="flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-md text-(--gray-9) hover:bg-(--gray-a3) hover:text-(--gray-12)"
          >
            <ArrowSquareOut size={12} weight="bold" />
          </button>
        </Tooltip>
        <Tooltip content="Dismiss">
          <button
            type="button"
            aria-label="Dismiss suggestion"
            onClick={(e) => {
              e.stopPropagation();
              onDismiss(task);
            }}
            className="flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-md text-(--gray-9) hover:bg-(--gray-a3) hover:text-(--gray-12)"
          >
            <X size={12} weight="bold" />
          </button>
        </Tooltip>
      </Flex>
    </motion.div>
  );
}
