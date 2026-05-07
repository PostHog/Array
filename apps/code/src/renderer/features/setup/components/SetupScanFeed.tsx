import { DotsCircleSpinner } from "@components/DotsCircleSpinner";
import type { Icon } from "@phosphor-icons/react";
import {
  ArrowsClockwise,
  ArrowsLeftRight,
  Brain,
  CheckCircle,
  FileText,
  Globe,
  MagnifyingGlass,
  PencilSimple,
  Terminal,
  Trash,
  Wrench,
} from "@phosphor-icons/react";
import { Flex, Text } from "@radix-ui/themes";
import { AnimatePresence, motion } from "framer-motion";

interface ActivityEntry {
  id: number;
  toolCallId: string;
  tool: string;
  filePath: string | null;
  title: string;
}

interface SetupScanFeedProps {
  label: string;
  icon: Icon;
  color: string;
  currentTool: string | null;
  recentEntries: ActivityEntry[];
  isDone: boolean;
  doneLabel?: string;
}

const TOOL_VERBS: Record<string, string> = {
  Read: "Reading a file...",
  Glob: "Searching files...",
  Grep: "Searching code...",
  Bash: "Running a command...",
  Edit: "Making changes...",
  Write: "Writing a file...",
  Agent: "Thinking...",
  ListDirectory: "Browsing files...",
  ToolSearch: "Looking up tools...",
  WebSearch: "Searching the web...",
  WebFetch: "Fetching a page...",
  NotebookEdit: "Editing notebook...",
  Monitor: "Monitoring...",
  SearchReplace: "Making changes...",
  MultiEdit: "Making changes...",
  StructuredOutput: "Preparing results...",
  create_output: "Preparing results...",
  WrappingUp: "Wrapping up...",
  TodoRead: "Reviewing tasks...",
  TodoWrite: "Updating tasks...",
  TaskCreate: "Creating a task...",
  TaskUpdate: "Updating a task...",
  TaskGet: "Checking task status...",
  TaskList: "Listing tasks...",
  AskFollowupQuestion: "Thinking...",
};

const TOOL_KIND: Record<string, string> = {
  Read: "read",
  Edit: "edit",
  Write: "edit",
  Grep: "search",
  Glob: "search",
  Bash: "execute",
  Agent: "think",
  ToolSearch: "search",
  WebSearch: "search",
  WebFetch: "fetch",
  StructuredOutput: "other",
  create_output: "other",
  WrappingUp: "think",
};

const KIND_ICONS: Record<string, Icon> = {
  read: FileText,
  edit: PencilSimple,
  delete: Trash,
  move: ArrowsLeftRight,
  search: MagnifyingGlass,
  execute: Terminal,
  think: Brain,
  fetch: Globe,
  switch_mode: ArrowsClockwise,
  other: Wrench,
};

function shortenPath(path: string): string {
  const parts = path.split("/");
  if (parts.length <= 3) return path;
  return `.../${parts.slice(-3).join("/")}`;
}

const GENERIC_TITLES = new Set([
  "Read File",
  "Execute command",
  "Edit",
  "Write",
  "Find",
  "Fetch",
  "Working",
  "Task",
  "Terminal",
]);

function entryDisplayText(entry: ActivityEntry): string {
  if (entry.filePath) return shortenPath(entry.filePath);
  if (entry.title && !GENERIC_TITLES.has(entry.title)) return entry.title;
  return TOOL_VERBS[entry.tool] ?? "Working...";
}

function toolLabel(tool: string): string {
  return TOOL_VERBS[tool] ?? "Working...";
}

export function SetupScanFeed({
  label,
  icon: LabelIcon,
  color,
  currentTool,
  recentEntries,
  isDone,
  doneLabel = "Complete",
}: SetupScanFeedProps) {
  const activeLabel = currentTool ? toolLabel(currentTool) : "Starting...";

  return (
    <Flex direction="column" gap="0" className="w-full">
      <Flex
        align="center"
        gap="3"
        px="4"
        className="h-12 rounded-xl border border-(--gray-a3) bg-(--color-panel-solid)"
        style={{
          boxShadow: "0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.02)",
        }}
      >
        <Flex align="center" gap="2" className="shrink-0">
          <Flex
            align="center"
            justify="center"
            className="h-7 w-7 shrink-0 rounded-md"
            style={{
              backgroundColor: isDone ? "var(--green-3)" : `var(--${color}-3)`,
            }}
          >
            {isDone ? (
              <motion.div
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", damping: 15, stiffness: 300 }}
                className="flex items-center justify-center"
              >
                <CheckCircle size={16} weight="fill" color="var(--green-9)" />
              </motion.div>
            ) : (
              <LabelIcon size={16} color={`var(--${color}-9)`} />
            )}
          </Flex>
          <Text
            size="2"
            weight="medium"
            className="whitespace-nowrap text-(--gray-12)"
          >
            {label}
          </Text>
        </Flex>

        <div className="relative h-5 min-w-0 flex-1">
          <AnimatePresence mode="wait">
            {!isDone && activeLabel && (
              <motion.div
                key={activeLabel}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="absolute top-0 right-0 flex h-5 max-w-full items-center gap-1.5"
              >
                <DotsCircleSpinner size={14} className="text-(--gray-9)" />
                <Text size="1" className="truncate text-(--gray-9)">
                  {activeLabel}
                </Text>
              </motion.div>
            )}
            {isDone && (
              <motion.div
                key="done"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.25 }}
                className="absolute top-0 right-0 flex h-5 items-center gap-1"
              >
                <Text size="1" weight="medium" className="text-(--gray-11)">
                  {doneLabel}
                </Text>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </Flex>

      {!isDone && recentEntries.length > 0 && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          transition={{
            height: { duration: 0.3, ease: "easeOut" },
            opacity: { duration: 0.2 },
          }}
          className="overflow-hidden"
        >
          <Flex
            direction="column"
            gap="0"
            px="3"
            py="2"
            mx="4"
            className="max-h-[120px] overflow-hidden rounded-b-[10px] bg-(--gray-2)"
          >
            <AnimatePresence initial={false} mode="popLayout">
              {recentEntries.slice(-4).map((entry, index, arr) => {
                const isLatest = index === arr.length - 1;
                const kind = TOOL_KIND[entry.tool] ?? "other";
                const EntryIcon = KIND_ICONS[kind] ?? Wrench;
                const entryText = entryDisplayText(entry);
                return (
                  <motion.div
                    key={entry.id}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: isLatest ? 1 : 0.45, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{
                      duration: 0.2,
                      layout: { type: "spring", damping: 25, stiffness: 300 },
                    }}
                  >
                    <Flex align="center" gap="2" className="h-6">
                      <EntryIcon
                        size={12}
                        weight="regular"
                        color="var(--gray-9)"
                        className="shrink-0"
                      />
                      <Text
                        size="1"
                        className="font-(family-name:--code-font-family) truncate text-(--gray-9) text-[11px]"
                      >
                        {entryText}
                      </Text>
                    </Flex>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </Flex>
        </motion.div>
      )}
    </Flex>
  );
}
