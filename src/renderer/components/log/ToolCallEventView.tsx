import type { AgentEvent } from "@posthog/agent";
import { Box, Code } from "@radix-ui/themes";
import { BaseLogEntry } from "@renderer/components/log/BaseLogEntry";
import { ToolCallView } from "@renderer/components/log/ToolCallView";
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
} from "@renderer/components/log/tools";

interface ToolCallEventViewProps {
  event: Extract<AgentEvent, { type: "tool_call" }>;
}

function renderToolCall(toolName: string, args: Record<string, any>) {
  switch (toolName) {
    case "Read":
      return <ReadToolView args={args} />;
    case "Write":
      return <WriteToolView args={args} />;
    case "Edit":
      return <EditToolView args={args} />;
    case "Glob":
      return <GlobToolView args={args} />;
    case "NotebookEdit":
      return <NotebookEditToolView args={args} />;
    case "Bash":
      return <BashToolView args={args} />;
    case "BashOutput":
      return <BashOutputToolView args={args} />;
    case "KillShell":
      return <KillShellToolView args={args} />;
    case "WebFetch":
      return <WebFetchToolView args={args} />;
    case "WebSearch":
      return <WebSearchToolView args={args} />;
    case "Grep":
      return <GrepToolView args={args} />;
    case "Task":
      return <TaskToolView args={args} />;
    case "TodoWrite":
      return <TodoWriteToolView args={args} />;
    case "ExitPlanMode":
      return <ExitPlanModeToolView args={args} />;
    case "SlashCommand":
      return <SlashCommandToolView args={args} />;
    default:
      return <ToolCallView toolName={toolName} callId="" args={args} />;
  }
}

export function ToolCallEventView({ event }: ToolCallEventViewProps) {
  return (
    <BaseLogEntry ts={event.ts} mb="3">
      <Code size="2" variant="ghost">
        tool_call
      </Code>
      <Box
        mt="1"
        className="overflow-hidden rounded-3 border border-gray-6 p-3"
      >
        {renderToolCall(event.toolName, event.args)}
      </Box>
    </BaseLogEntry>
  );
}
