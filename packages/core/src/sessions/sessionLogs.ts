import type { AcpMessage, Adapter, StoredLogEntry } from "@posthog/shared";
import { isJsonRpcRequest } from "@posthog/shared";

export interface ParsedSessionLogs {
  rawEntries: StoredLogEntry[];
  totalLineCount: number;
  parseFailureCount: number;
  sessionId?: string;
  adapter?: Adapter;
}

export function parseSessionLogContent(
  content: string,
  options: { onParseError?: (line: string) => void } = {},
): ParsedSessionLogs {
  const rawEntries: StoredLogEntry[] = [];
  let sessionId: string | undefined;
  let adapter: Adapter | undefined;
  let parseFailureCount = 0;
  const lines = content.trim().split("\n");

  for (const line of lines) {
    try {
      const stored = JSON.parse(line) as StoredLogEntry;
      rawEntries.push(stored);

      if (
        stored.type === "notification" &&
        stored.notification?.method?.endsWith("posthog/sdk_session")
      ) {
        const params = stored.notification.params as {
          sessionId?: string;
          sdkSessionId?: string;
          adapter?: Adapter;
        };
        if (params?.sessionId) sessionId = params.sessionId;
        else if (params?.sdkSessionId) sessionId = params.sdkSessionId;
        if (params?.adapter) adapter = params.adapter;
      }
    } catch {
      parseFailureCount += 1;
      options.onParseError?.(line);
    }
  }

  return {
    rawEntries,
    totalLineCount: lines.length,
    parseFailureCount,
    sessionId,
    adapter,
  };
}

export function planSkippedPromptFilter(
  skipPolledPromptCount: number | undefined,
  events: AcpMessage[],
): { events: AcpMessage[]; remainingSkipCount: number } | null {
  if (!skipPolledPromptCount || skipPolledPromptCount <= 0) {
    return null;
  }

  const promptIdx = events.findIndex(
    (e) => isJsonRpcRequest(e.message) && e.message.method === "session/prompt",
  );
  if (promptIdx === -1) {
    return null;
  }

  const filtered = [...events];
  filtered.splice(promptIdx, 1);
  return { events: filtered, remainingSkipCount: skipPolledPromptCount - 1 };
}
