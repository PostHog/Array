import type { SessionNotification } from "@agentclientprotocol/sdk";
import {
  BashToolView,
  EditToolView,
  GlobToolView,
  GrepToolView,
  ReadToolView,
  WebFetchToolView,
} from "@features/logs/tools";
import { ToolExecutionWrapper } from "@features/logs/tools/ToolUI";
import {
  Check as CheckIcon,
  CircleNotch as CircleNotchIcon,
  Terminal as ExecuteIcon,
  Download as FetchIcon,
  File as FileIcon,
  ArrowsDownUp as MoveIcon,
  Cube as OtherIcon,
  PencilSimple as PencilIcon,
  MagnifyingGlass as SearchIcon,
  Brain as ThinkIcon,
  Trash as TrashIcon,
  X as XIcon,
} from "@phosphor-icons/react";
import type { AgentNotification } from "@posthog/agent";
import { Box, Code } from "@radix-ui/themes";
import { getNotificationTimestamp } from "@utils/notification-helpers";
import type { ReactNode } from "react";

interface ToolExecutionViewProps {
  initialCall: AgentNotification;
  updates: AgentNotification[];
  forceExpanded?: boolean;
  onJumpToRaw?: (index: number) => void;
  index?: number;
}

type ToolKind =
  | "read"
  | "edit"
  | "delete"
  | "move"
  | "search"
  | "execute"
  | "think"
  | "fetch"
  | "other";

// Helper to extract tool name from ACP notification
function extractToolName(
  title: string,
  kind?: ToolKind,
  rawInput?: Record<string, unknown>,
): string {
  // Use kind and rawInput to identify the tool
  if (kind === "execute" && rawInput?.command) {
    return "Bash";
  }
  if (kind === "search") {
    if (rawInput?.pattern) {
      // Check if it's a glob pattern (has * or ** without regex chars)
      const pattern = rawInput.pattern;
      if (typeof pattern === "string" && /^[*./\w-]+$/.test(pattern)) {
        return "Glob";
      }
      return "Grep";
    }
  }

  // Fallback to extracting from title
  // ACP titles are like "Read /path/to/file" or "Edit `file.txt`"
  let firstWord = title.split(" ")[0] || "Unknown";

  // Remove backticks if present
  firstWord = firstWord.replace(/`/g, "");

  // Capitalize first letter
  return firstWord.charAt(0).toUpperCase() + firstWord.slice(1);
}

// Get icon component based on tool kind
function getToolKindIcon(kind?: ToolKind): typeof FileIcon {
  switch (kind) {
    case "read":
      return FileIcon;
    case "edit":
      return PencilIcon;
    case "delete":
      return TrashIcon;
    case "move":
      return MoveIcon;
    case "search":
      return SearchIcon;
    case "execute":
      return ExecuteIcon;
    case "think":
      return ThinkIcon;
    case "fetch":
      return FetchIcon;
    default:
      return OtherIcon;
  }
}

// Helper to extract result from tool_call_update content
function extractToolResult(
  content?: Record<string, unknown>[],
): string | Record<string, unknown> | undefined {
  if (!content || content.length === 0) return undefined;

  // Check for text content - ACP format
  const textContent = content.find(
    (c) =>
      c.type === "content" &&
      typeof c.content === "object" &&
      c.content !== null &&
      (c.content as Record<string, unknown>).type === "text",
  ) as Record<string, unknown> | undefined;
  if (
    textContent?.content &&
    typeof textContent.content === "object" &&
    (textContent.content as Record<string, unknown>).text
  ) {
    return (textContent.content as Record<string, unknown>).text as string;
  }

  // Check for diff content - ACP format
  const diffContent = content.find((c) => c.type === "diff") as
    | Record<string, unknown>
    | undefined;
  if (diffContent) {
    return {
      type: "diff",
      path: diffContent.path,
      oldText: diffContent.oldText,
      newText: diffContent.newText,
    };
  }

  // Check for terminal content - ACP format
  const terminalContent = content.find((c) => c.type === "terminal") as
    | Record<string, unknown>
    | undefined;
  if (terminalContent) {
    return {
      type: "terminal",
      terminalId: terminalContent.terminalId,
    };
  }

  // If no structured content found, try to extract raw text from any content block
  for (const item of content) {
    if (item.type === "content" && item.content) {
      if (typeof item.content === "string") {
        return item.content;
      }
      if (
        typeof item.content === "object" &&
        item.content !== null &&
        (item.content as Record<string, unknown>).text
      ) {
        return (item.content as Record<string, unknown>).text as string;
      }
    }
  }

  return undefined;
}

function getToolDisplayName(toolName: string): string {
  return toolName;
}

function getToolSummary(
  _toolName: string,
  _args: Record<string, unknown>,
): ReactNode {
  return null;
}

function renderToolContent(
  toolName: string,
  args: Record<string, unknown>,
  result?: unknown,
) {
  // Extract args and result if structured
  const resultArgs: Record<string, unknown> =
    result && typeof result === "object" && "args" in result
      ? (result.args as Record<string, unknown>)
      : args;
  const actualResult =
    result && typeof result === "object" && "result" in result
      ? result.result
      : result;

  switch (toolName) {
    case "Read":
      return <ReadToolView args={resultArgs} result={actualResult} />;
    case "Edit":
      return <EditToolView args={resultArgs} result={actualResult} />;
    case "Glob":
      return <GlobToolView args={resultArgs} result={actualResult} />;
    case "Bash":
      return <BashToolView args={resultArgs} result={actualResult} />;
    case "WebFetch":
      return <WebFetchToolView args={resultArgs} result={actualResult} />;
    case "Grep":
      return <GrepToolView args={resultArgs} result={actualResult} />;
    default: {
      // Fallback: render as JSON
      const data = result !== undefined ? { args, result: actualResult } : args;
      return (
        <Box>
          <Code
            size="2"
            variant="outline"
            className="block overflow-x-auto whitespace-pre-wrap p-2"
          >
            {JSON.stringify(data, null, 2)}
          </Code>
        </Box>
      );
    }
  }
}

export function ToolExecutionView({
  initialCall,
  updates,
  forceExpanded = false,
  onJumpToRaw,
  index,
}: ToolExecutionViewProps) {
  // Ensure initialCall is a SessionNotification
  if (!("sessionId" in initialCall && "update" in initialCall)) {
    return null;
  }

  const { update: initialUpdate } = initialCall as SessionNotification;

  // Only handle tool_call
  if (
    !("sessionUpdate" in initialUpdate) ||
    initialUpdate.sessionUpdate !== "tool_call"
  ) {
    return null;
  }

  // Get the latest update for status
  const latestUpdate = updates.length > 0 ? updates[updates.length - 1] : null;
  const latestUpdateData =
    latestUpdate && "sessionId" in latestUpdate && "update" in latestUpdate
      ? (latestUpdate as SessionNotification).update
      : null;

  // Merge initial call with updates
  const title = "title" in initialUpdate ? (initialUpdate.title ?? "") : "";
  const kind: ToolKind | undefined =
    "kind" in initialUpdate ? (initialUpdate.kind as ToolKind) : undefined;
  const status =
    latestUpdateData && "status" in latestUpdateData
      ? (latestUpdateData.status ?? initialUpdate.status ?? "pending")
      : (initialUpdate.status ?? "pending");
  const rawInput =
    "rawInput" in initialUpdate ? initialUpdate.rawInput : undefined;

  // Merge rawOutput from all updates (prefer latest non-empty)
  let rawOutput =
    "rawOutput" in initialUpdate ? initialUpdate.rawOutput : undefined;
  for (const update of updates) {
    if ("sessionId" in update && "update" in update) {
      const updateData = (update as SessionNotification).update;
      if ("rawOutput" in updateData && updateData.rawOutput) {
        rawOutput = updateData.rawOutput;
      }
    }
  }

  // Merge content from all updates (prefer latest non-empty)
  let content = "content" in initialUpdate ? initialUpdate.content : undefined;
  for (const update of updates) {
    if ("sessionId" in update && "update" in update) {
      const updateData = (update as SessionNotification).update;
      if (
        "content" in updateData &&
        updateData.content &&
        Array.isArray(updateData.content) &&
        updateData.content.length > 0
      ) {
        content = updateData.content;
      }
    }
  }

  // Extract tool name and args
  const toolName = extractToolName(
    title,
    kind,
    rawInput as Record<string, unknown>,
  );

  // Extract args from rawInput, handling both direct object and nested structures
  let args: Record<string, unknown> = {};
  if (rawInput) {
    // If rawInput has nested structure, flatten it
    if (typeof rawInput === "object") {
      args = rawInput as Record<string, unknown>;
    }
  }

  // Ensure content is an array before passing to extractToolResult
  const contentArray = content
    ? Array.isArray(content)
      ? content
      : undefined
    : undefined;

  // Extract result from content or rawOutput
  // rawOutput is used for tools like Bash that return structured data (stdout/stderr/exitCode)
  // content is used for tools that return formatted content (text, diffs, etc)
  const result = rawOutput || extractToolResult(contentArray);

  // Determine state
  const isPending = status === "pending" || status === "in_progress";
  const isError = status === "failed";
  const summary = getToolSummary(toolName, args);

  // Determine status badge
  let statusBadge: React.ReactNode = null;
  let statusColor: string;

  if (isPending) {
    statusColor = "blue";
    statusBadge = <CircleNotchIcon size={14} className="animate-spin" />;
  } else if (isError) {
    statusColor = "red";
    statusBadge = <XIcon size={14} weight="bold" />;
  } else {
    statusColor = "green";
    statusBadge = <CheckIcon size={14} weight="bold" />;
  }

  // Get kind icon
  const KindIconComponent = getToolKindIcon(kind);
  const kindIconElement = <KindIconComponent size={14} />;

  // Extract timestamp from initial call
  const timestamp = getNotificationTimestamp(initialCall) ?? Date.now();

  return (
    <Box mb="3">
      <ToolExecutionWrapper
        toolName={getToolDisplayName(toolName)}
        statusBadge={statusBadge}
        statusColor={statusColor}
        summary={summary}
        timestamp={timestamp}
        durationMs={undefined}
        isError={isError}
        forceExpanded={forceExpanded}
        onJumpToRaw={onJumpToRaw}
        index={index}
        kindIcon={kindIconElement}
      >
        {renderToolContent(toolName, args, result)}
      </ToolExecutionWrapper>
    </Box>
  );
}
