import type { DiscoveredTask } from "@features/setup/types";
import {
  CATEGORY_CONFIG,
  FALLBACK_CATEGORY_CONFIG,
} from "@features/setup/utils/categoryConfig";
import { ArrowRight } from "@phosphor-icons/react";
import { Flex, Text } from "@radix-ui/themes";
import { motion } from "framer-motion";

type Variant = "default" | "compact";

interface SuggestedTasksProps {
  tasks: DiscoveredTask[];
  onSelectTask: (task: DiscoveredTask) => void;
  variant?: Variant;
  /** When set, uses CSS grid with the given column class instead of a vertical stack. */
  layoutClassName?: string;
}

export function SuggestedTasks({
  tasks,
  onSelectTask,
  variant = "default",
  layoutClassName,
}: SuggestedTasksProps) {
  if (tasks.length === 0) {
    return (
      <Flex align="center" justify="center" py="4" className="text-(--gray-9)">
        <Text size="2">No issues found. Your codebase looks clean!</Text>
      </Flex>
    );
  }

  const containerClass = layoutClassName ?? "flex w-full flex-col gap-3";

  return (
    <div className={containerClass}>
      {tasks.map((task, index) => (
        <SuggestedTaskCard
          key={task.id}
          task={task}
          index={index}
          variant={variant}
          onSelect={onSelectTask}
        />
      ))}
    </div>
  );
}

interface SuggestedTaskCardProps {
  task: DiscoveredTask;
  index: number;
  variant: Variant;
  onSelect: (task: DiscoveredTask) => void;
}

function SuggestedTaskCard({
  task,
  index,
  variant,
  onSelect,
}: SuggestedTaskCardProps) {
  const config = CATEGORY_CONFIG[task.category] ?? FALLBACK_CATEGORY_CONFIG;
  const TaskIcon = config.icon;
  const isCompact = variant === "compact";
  const iconSize = isCompact ? 14 : 18;
  const titleSize = isCompact ? "1" : "2";

  return (
    <motion.button
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.08 }}
      onClick={() => onSelect(task)}
      type="button"
      className={`flex w-full cursor-pointer items-start rounded-xl border border-(--gray-a3) bg-(--color-panel-solid) text-left transition-[border-color,box-shadow] ${
        isCompact ? "gap-2.5 px-2.5 py-2" : "gap-3.5 px-[18px] py-4"
      }`}
      style={{
        boxShadow: "0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.02)",
      }}
      whileHover={{
        borderColor: `var(--${config.color}-6)`,
        boxShadow: "0 2px 8px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.04)",
      }}
    >
      <Flex
        align="center"
        justify="center"
        className={`shrink-0 ${
          isCompact ? "h-6 w-6 rounded-md" : "mt-0.5 h-8 w-8 rounded-lg"
        }`}
        style={{ backgroundColor: `var(--${config.color}-3)` }}
      >
        <TaskIcon
          size={iconSize}
          weight="duotone"
          color={`var(--${config.color}-9)`}
        />
      </Flex>
      <Flex direction="column" gap="1" className="min-w-0 flex-1">
        <Flex align="center" justify="between" gap="2">
          <Text
            size={titleSize}
            weight="medium"
            className="min-w-0 flex-1 truncate text-(--gray-12)"
          >
            {task.title}
          </Text>
          <ArrowRight
            size={isCompact ? 12 : 14}
            color="var(--gray-8)"
            className="shrink-0"
          />
        </Flex>
        <Text
          size="1"
          className={`text-(--gray-11) leading-normal ${
            isCompact ? "line-clamp-1" : "line-clamp-2"
          }`}
        >
          {task.description}
        </Text>
        {task.file && (
          <Text
            size="1"
            className={`truncate text-(--gray-9) italic ${
              isCompact ? "" : "mt-0.5"
            }`}
          >
            {task.file}
            {task.lineHint ? `:${task.lineHint}` : ""}
          </Text>
        )}
      </Flex>
    </motion.button>
  );
}
