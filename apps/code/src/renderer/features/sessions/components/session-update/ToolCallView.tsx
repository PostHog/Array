import type { CodeToolKind } from "@features/sessions/types";
import {
  ArrowsClockwise,
  ArrowsLeftRight,
  Brain,
  ChatCircle,
  Command,
  FileText,
  Globe,
  type Icon,
  MagnifyingGlass,
  PencilSimple,
  Terminal,
  Trash,
  Wrench,
} from "@phosphor-icons/react";
import { Box, Flex } from "@radix-ui/themes";
import { compactHomePath } from "@utils/path";
import { useState } from "react";
import {
  compactInput,
  ExpandableIcon,
  ExpandedContentBox,
  formatInput,
  getContentText,
  getFilename,
  StatusIndicators,
  stripCodeFences,
  ToolTitle,
  type ToolViewProps,
  useToolCallStatus,
} from "./toolCallUtils";

const kindIcons: Record<CodeToolKind, Icon> = {
  read: FileText,
  edit: PencilSimple,
  delete: Trash,
  move: ArrowsLeftRight,
  search: MagnifyingGlass,
  execute: Terminal,
  think: Brain,
  fetch: Globe,
  switch_mode: ArrowsClockwise,
  question: ChatCircle,
  other: Wrench,
};

const toolNameIcons: Record<string, Icon> = {
  ToolSearch: MagnifyingGlass,
  Skill: Command,
};

// Tools that render a friendly "<prefix> `<input>` <suffix>" line instead of
// the raw JSON input preview. `inputKey` is the rawInput field to highlight.
const toolNameDisplays: Record<
  string,
  { prefix: string; suffix: string; inputKey: string }
> = {
  Skill: { prefix: "Reading", suffix: "skill", inputKey: "skill" },
  ToolSearch: { prefix: "Searching", suffix: "tools", inputKey: "query" },
};

interface ToolCallViewProps extends ToolViewProps {
  agentToolName?: string;
}

export function ToolCallView({
  toolCall,
  turnCancelled,
  turnComplete,
  agentToolName,
  expanded = false,
}: ToolCallViewProps) {
  const [isExpanded, setIsExpanded] = useState(expanded);
  const { title, kind, status, locations, content, rawInput } = toolCall;
  const { isLoading, isFailed, wasCancelled, isComplete } = useToolCallStatus(
    status,
    turnCancelled,
    turnComplete,
  );
  const KindIcon =
    (agentToolName && toolNameIcons[agentToolName]) ||
    (kind && kindIcons[kind]) ||
    Wrench;

  const filePath = kind === "read" && locations?.[0]?.path;
  const toolDisplay = agentToolName
    ? toolNameDisplays[agentToolName]
    : undefined;
  const highlightValue =
    toolDisplay && rawInput && typeof rawInput === "object"
      ? (rawInput as Record<string, unknown>)[toolDisplay.inputKey]
      : undefined;
  const specialDisplay =
    toolDisplay && typeof highlightValue === "string"
      ? { ...toolDisplay, value: highlightValue }
      : undefined;

  const displayText = specialDisplay
    ? specialDisplay.prefix
    : filePath
      ? `Read ${getFilename(filePath)}`
      : title
        ? compactHomePath(title)
        : undefined;

  const inputPreview = specialDisplay?.value ?? compactInput(rawInput);
  const fullInput = formatInput(rawInput);

  const output = stripCodeFences(getContentText(content) ?? "");
  const hasOutput = output.trim().length > 0;
  const isExpandable = !!fullInput || hasOutput;

  const handleClick = () => {
    if (isExpandable) {
      setIsExpanded(!isExpanded);
    }
  };

  return (
    <Box className="py-0.5">
      <Flex
        gap="2"
        className={`group min-w-0 ${isExpandable ? "cursor-pointer" : ""}`}
        onClick={handleClick}
      >
        <Box className="shrink-0 pt-px">
          <ExpandableIcon
            icon={KindIcon}
            isLoading={isLoading}
            isExpandable={isExpandable}
            isExpanded={isExpanded}
          />
        </Box>
        <Flex align="center" gap="1" wrap="wrap" className="min-w-0">
          <ToolTitle>{displayText}</ToolTitle>
          {inputPreview && (
            <ToolTitle>
              <span className="font-mono text-accent-11">{inputPreview}</span>
            </ToolTitle>
          )}
          {specialDisplay && <ToolTitle>{specialDisplay.suffix}</ToolTitle>}
          <StatusIndicators isFailed={isFailed} wasCancelled={wasCancelled} />
        </Flex>
      </Flex>

      {isExpanded && (
        <>
          {fullInput && <ExpandedContentBox>{fullInput}</ExpandedContentBox>}
          {isComplete && hasOutput && (
            <ExpandedContentBox>{output}</ExpandedContentBox>
          )}
        </>
      )}
    </Box>
  );
}
