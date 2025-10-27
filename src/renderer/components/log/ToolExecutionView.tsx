import {
  BashOutputToolView,
  BashToolView,
  EditToolView,
  ExitPlanModeToolView,
  GlobToolView,
  GrepToolView,
  KillShellToolView,
  NotebookEditToolView,
  ReadToolView,
  SlashCommandToolView,
  TaskToolView,
  TodoWriteToolView,
  WebFetchToolView,
  WebSearchToolView,
  WriteToolView,
} from "@components/log/tools";
import { ToolExecutionWrapper } from "@components/log/tools/ToolUI";
import {
  Check as CheckIcon,
  CircleNotch as CircleNotchIcon,
  X as XIcon,
} from "@phosphor-icons/react";
import type { AgentEvent } from "@posthog/agent";
import { Box, Code } from "@radix-ui/themes";
import type { ReactNode } from "react";

interface ToolExecutionViewProps {
  call: Extract<AgentEvent, { type: "tool_call" }>;
  result?: Extract<AgentEvent, { type: "tool_result" }>;
  forceExpanded?: boolean;
  onJumpToRaw?: (index: number) => void;
  index?: number;
}

// Map tool names to their view components
const TOOL_VIEW_MAP: Record<
  string,
  React.ComponentType<{ args: any; result?: any }>
> = {
  Read: ReadToolView,
  Write: WriteToolView,
  Edit: EditToolView,
  Glob: GlobToolView,
  NotebookEdit: NotebookEditToolView,
  Bash: BashToolView,
  BashOutput: BashOutputToolView,
  KillShell: KillShellToolView,
  WebFetch: WebFetchToolView,
  WebSearch: WebSearchToolView,
  Grep: GrepToolView,
  Task: TaskToolView,
  TodoWrite: TodoWriteToolView,
  ExitPlanMode: ExitPlanModeToolView,
  SlashCommand: SlashCommandToolView,
};

function getToolDisplayName(toolName: string): string {
  switch (toolName) {
    case "TodoWrite":
      return "Todo Progress";
    default:
      return toolName;
  }
}

function getToolSummary(
  toolName: string,
  args: Record<string, any>,
): ReactNode {
  switch (toolName) {
    case "Bash":
      return (
        <Code size="1" color="gray" variant="ghost">
          {args.description || args.command || ""}
        </Code>
      );
    case "Read":
      return (
        <Code size="1" color="gray" variant="ghost">
          {args.file_path || ""}
        </Code>
      );
    case "Write":
      return (
        <Code size="1" color="gray" variant="ghost">
          {args.file_path || ""}
        </Code>
      );
    case "Edit": {
      const filePath = args.file_path || "";
      const oldString = args.old_string || "";
      const newString = args.new_string || "";

      // Calculate lines added and removed
      const oldLines = oldString.split("\n").length;
      const newLines = newString.split("\n").length;
      const linesAdded = Math.max(0, newLines - oldLines);
      const linesRemoved = Math.max(0, oldLines - newLines);

      return (
        <Box style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <Code size="1" color="gray" variant="ghost">
            {filePath}
          </Code>
          {linesAdded > 0 && (
            <Code size="1" color="green" variant="soft">
              +{linesAdded}
            </Code>
          )}
          {linesRemoved > 0 && (
            <Code size="1" color="red" variant="soft">
              -{linesRemoved}
            </Code>
          )}
        </Box>
      );
    }
    case "Glob":
      return (
        <Code size="1" color="gray" variant="ghost">
          {args.pattern || ""}
        </Code>
      );
    case "Grep":
      return (
        <Code size="1" color="gray" variant="ghost">
          {args.pattern || ""}
        </Code>
      );
    case "NotebookEdit":
      return (
        <Code size="1" color="gray" variant="ghost">
          {args.notebook_path || ""}
        </Code>
      );
    case "BashOutput":
      return (
        <Code size="1" color="gray" variant="ghost">
          {args.bash_id || ""}
        </Code>
      );
    case "KillShell":
      return (
        <Code size="1" color="gray" variant="ghost">
          {args.shell_id || ""}
        </Code>
      );
    case "WebFetch":
      return (
        <Code size="1" color="gray" variant="ghost">
          {args.url || ""}
        </Code>
      );
    case "WebSearch":
      return (
        <Code size="1" color="gray" variant="ghost">
          {args.query || ""}
        </Code>
      );
    case "Task":
      return (
        <Code size="1" color="gray" variant="ghost">
          {args.description || ""}
        </Code>
      );
    case "TodoWrite": {
      const todos = args.todos || [];
      const inProgressTodo = todos.find((t: any) => t.status === "in_progress");
      const currentIndex = todos.findIndex(
        (t: any) => t.status === "in_progress",
      );
      const totalTodos = todos.length;

      if (inProgressTodo && currentIndex !== -1) {
        return (
          <Box style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <Code size="1" color="blue" variant="soft">
              {inProgressTodo.activeForm}
            </Code>
            <Code size="1" color="gray" variant="ghost">
              ({currentIndex + 1}/{totalTodos})
            </Code>
          </Box>
        );
      }

      // If no in-progress todo, show completed count
      const completed = todos.filter(
        (t: any) => t.status === "completed",
      ).length;
      if (completed === totalTodos && totalTodos > 0) {
        return (
          <Code size="1" color="green" variant="soft">
            All tasks completed ({totalTodos}/{totalTodos})
          </Code>
        );
      }

      return null;
    }
    case "ExitPlanMode":
      return null;
    case "SlashCommand":
      return (
        <Code size="1" color="gray" variant="ghost">
          {args.command || ""}
        </Code>
      );
    default:
      return null;
  }
}

function renderToolContent(
  toolName: string,
  args: Record<string, any>,
  result?: any,
) {
  // Extract args and result if structured
  const resultArgs =
    result && typeof result === "object" && "args" in result
      ? result.args
      : args;
  const actualResult =
    result && typeof result === "object" && "result" in result
      ? result.result
      : result;

  // Look up the component
  const ToolComponent = TOOL_VIEW_MAP[toolName];

  if (ToolComponent) {
    return <ToolComponent args={resultArgs} result={actualResult} />;
  }

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

export function ToolExecutionView({
  call,
  result,
  forceExpanded = false,
  onJumpToRaw,
  index,
}: ToolExecutionViewProps) {
  const isPending = !result;
  const isError = result?.isError || false;
  const summary = getToolSummary(call.toolName, call.args);

  // Calculate duration if result is available
  const durationMs = result?.ts ? result.ts - call.ts : undefined;

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

  return (
    <Box mb="3">
      <ToolExecutionWrapper
        toolName={getToolDisplayName(call.toolName)}
        statusBadge={statusBadge}
        statusColor={statusColor}
        summary={summary}
        timestamp={call.ts}
        durationMs={durationMs}
        isError={isError}
        forceExpanded={forceExpanded}
        onJumpToRaw={onJumpToRaw}
        index={index}
      >
        {renderToolContent(call.toolName, call.args, result?.result)}
      </ToolExecutionWrapper>
    </Box>
  );
}
