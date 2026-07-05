import { Terminal } from "@phosphor-icons/react";
import { compactHomePath } from "@posthog/shared";
import { useChatThreadChrome } from "../chat-thread/chatThreadChrome";
import { ToolRow } from "./ToolRow";
import {
  ContentPre,
  getContentText,
  stripCodeFences,
  ToolTitle,
  type ToolViewProps,
  truncateText,
  useToolCallStatus,
} from "./toolCallUtils";

const ANSI_REGEX = new RegExp(`${String.fromCharCode(0x1b)}\\[[0-9;]*m`, "g");
const MAX_COMMAND_LENGTH = 120;

interface ExecuteRawInput {
  command?: string;
  description?: string;
}

export function ExecuteToolView({
  toolCall,
  turnCancelled,
  turnComplete,
  expanded = false,
}: ToolViewProps) {
  const { status, rawInput, content, title } = toolCall;
  const { isLoading, isFailed, wasCancelled } = useToolCallStatus(
    status,
    turnCancelled,
    turnComplete,
  );

  const executeInput = rawInput as ExecuteRawInput | undefined;
  const command = executeInput?.command ?? "";
  const description =
    executeInput?.description ?? (command ? undefined : title);

  // New thread hides the inline command chip (the ChatMarker title carries it); the legacy thread
  // keeps showing it so ConversationView is unchanged when the chat thread is toggled off.
  const chatChrome = useChatThreadChrome();

  const output = stripCodeFences(getContentText(content) ?? "").replace(
    ANSI_REGEX,
    "",
  );
  const hasOutput = output.trim().length > 0;

  return (
    <ToolRow
      icon={Terminal}
      isLoading={isLoading}
      isFailed={isFailed}
      wasCancelled={wasCancelled}
      defaultOpen={expanded}
      content={hasOutput ? <ContentPre>{output}</ContentPre> : undefined}
    >
      {description && <ToolTitle>{description}</ToolTitle>}
      {!chatChrome && command && (
        <ToolTitle className="min-w-0 truncate">
          <span
            className="block truncate border border-border bg-gray-5 font-mono"
            title={command}
          >
            {truncateText(compactHomePath(command), MAX_COMMAND_LENGTH)}
          </span>
        </ToolTitle>
      )}
    </ToolRow>
  );
}
