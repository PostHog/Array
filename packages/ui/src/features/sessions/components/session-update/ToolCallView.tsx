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
import { compactHomePath } from "@posthog/shared";
import type { CodeToolKind } from "@posthog/ui/features/sessions/types";
import { ToolRow } from "./ToolRow";
import {
  ContentPre,
  compactInput,
  formatInput,
  getContentText,
  getFilename,
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
  const showOutput = isComplete && hasOutput;

  const body =
    fullInput || showOutput ? (
      <>
        {fullInput && <ContentPre>{fullInput}</ContentPre>}
        {showOutput && (
          <div className={fullInput ? "border-gray-6 border-t" : undefined}>
            <ContentPre>{output}</ContentPre>
          </div>
        )}
      </>
    ) : undefined;

  return (
    <ToolRow
      icon={KindIcon}
      isLoading={isLoading}
      isFailed={isFailed}
      wasCancelled={wasCancelled}
      defaultOpen={expanded}
      content={body}
    >
      {displayText && <ToolTitle>{displayText}</ToolTitle>}
      {inputPreview && (
        <ToolTitle>
          <span className="font-mono text-accent-11">{inputPreview}</span>
        </ToolTitle>
      )}
      {specialDisplay && <ToolTitle>{specialDisplay.suffix}</ToolTitle>}
    </ToolRow>
  );
}
