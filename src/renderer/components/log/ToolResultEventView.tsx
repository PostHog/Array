import type { AgentEvent } from "@posthog/agent";
import { Box, Code } from "@radix-ui/themes";
import { BaseLogEntry } from "./BaseLogEntry";
import { ToolCallView } from "./ToolCallView";
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
} from "./tools";

interface ToolResultEventViewProps {
  event: Extract<AgentEvent, { type: "tool_result" }>;
}

function renderToolResult(
  toolName: string,
  args: Record<string, any>,
  result: any,
) {
  switch (toolName) {
    case "Read":
      return <ReadToolView args={args} result={result} />;
    case "Write":
      return <WriteToolView args={args} result={result} />;
    case "Edit":
      return <EditToolView args={args} result={result} />;
    case "Glob":
      return <GlobToolView args={args} result={result} />;
    case "NotebookEdit":
      return <NotebookEditToolView args={args} result={result} />;
    case "Bash":
      return <BashToolView args={args} result={result} />;
    case "BashOutput":
      return <BashOutputToolView args={args} result={result} />;
    case "KillShell":
      return <KillShellToolView args={args} result={result} />;
    case "WebFetch":
      return <WebFetchToolView args={args} result={result} />;
    case "WebSearch":
      return <WebSearchToolView args={args} result={result} />;
    case "Grep":
      return <GrepToolView args={args} result={result} />;
    case "Task":
      return <TaskToolView args={args} result={result} />;
    case "TodoWrite":
      return <TodoWriteToolView args={args} result={result} />;
    case "ExitPlanMode":
      return <ExitPlanModeToolView args={args} result={result} />;
    case "SlashCommand":
      return <SlashCommandToolView args={args} result={result} />;
    default:
      return <ToolCallView toolName={toolName} callId="" args={result} />;
  }
}

export function ToolResultEventView({ event }: ToolResultEventViewProps) {
  const displayName = event.isError ? "tool_error" : "tool_result";
  const color = event.isError ? "red" : undefined;

  // Extract args from result if it's structured as {tool_name, args, result}
  const args =
    event.result && typeof event.result === "object" && "args" in event.result
      ? event.result.args
      : {};
  const result =
    event.result && typeof event.result === "object" && "result" in event.result
      ? event.result.result
      : event.result;

  return (
    <BaseLogEntry ts={event.ts} mb="3">
      <Code size="2" variant="ghost" color={color}>
        {displayName}
      </Code>
      <Box
        mt="1"
        className="overflow-hidden rounded-3 border border-gray-6 p-3"
      >
        {renderToolResult(event.toolName, args, result)}
      </Box>
    </BaseLogEntry>
  );
}
