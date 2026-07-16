export interface ThreadAgentMessage {
  id: string;
  text: string;
  timestamp?: number;
}

export interface ThreadHumanMessage<T = unknown> {
  id: string;
  content: string;
  createdAt: string;
  forwardedToAgent?: boolean;
  value?: T;
}

export type ThreadTimelineRow<T = unknown> =
  | { kind: "prompt"; timestamp: number; message: ThreadAgentMessage }
  | { kind: "agent"; timestamp: number; message: ThreadAgentMessage }
  | { kind: "human"; timestamp: number; message: ThreadHumanMessage<T> };

function validTimestamp(timestamp: number | undefined): number {
  return timestamp !== undefined && Number.isFinite(timestamp)
    ? timestamp
    : Number.MAX_SAFE_INTEGER;
}

function parsedTimestamp(timestamp: string): number {
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

export function buildThreadTimeline<T>({
  prompts,
  agentMessages,
  humanMessages,
}: {
  prompts: ThreadAgentMessage[];
  agentMessages: ThreadAgentMessage[];
  humanMessages: ThreadHumanMessage<T>[];
}): ThreadTimelineRow<T>[] {
  const forwardedHumanContent = new Set(
    humanMessages
      .filter((message) => message.forwardedToAgent)
      .map((message) => normalizeAgentPromptText(message.content)),
  );
  const visiblePrompts = prompts.filter(
    (message) =>
      !isThreadCommentPrompt(message.text) ||
      !forwardedHumanContent.has(normalizeAgentPromptText(message.text)),
  );

  return [
    ...visiblePrompts.map(
      (message): ThreadTimelineRow<T> => ({
        kind: "prompt",
        timestamp: validTimestamp(message.timestamp),
        message,
      }),
    ),
    ...humanMessages.map(
      (message): ThreadTimelineRow<T> => ({
        kind: "human",
        timestamp: parsedTimestamp(message.createdAt),
        message,
      }),
    ),
    ...agentMessages.map(
      (message): ThreadTimelineRow<T> => ({
        kind: "agent",
        timestamp: validTimestamp(message.timestamp),
        message,
      }),
    ),
  ].sort((left, right) => left.timestamp - right.timestamp);
}

export type ThreadAgentPhase = "active" | "needs_input" | "error";

export interface ThreadAgentStatus {
  phase: ThreadAgentPhase;
  label: string;
}

const AGENT_MENTION_PATTERN = /(^|\s)@agent\b/i;
const THREAD_COMMENT_ATTRIBUTION_PATTERN =
  /^\[Thread comment from [^\]\r\n]+\]\s*/i;
const LEADING_AGENT_MENTION_PATTERN = /^@agent\b[\s:]*/i;

export function hasAgentMention(content: string): boolean {
  return AGENT_MENTION_PATTERN.test(content);
}

export function normalizeAgentPromptText(content: string): string {
  return content
    .trim()
    .replace(THREAD_COMMENT_ATTRIBUTION_PATTERN, "")
    .replace(LEADING_AGENT_MENTION_PATTERN, "")
    .trim();
}

function isThreadCommentPrompt(content: string): boolean {
  return THREAD_COMMENT_ATTRIBUTION_PATTERN.test(content.trim());
}

export function deriveThreadAgentStatus({
  hasActivity = false,
  hasError = false,
  cloudStatus,
  errorTitle,
  pendingPermissionCount = 0,
  isPromptPending = false,
  isInitializing = false,
}: {
  hasActivity?: boolean;
  hasError?: boolean;
  cloudStatus?: string | null;
  errorTitle?: string | null;
  pendingPermissionCount?: number;
  isPromptPending?: boolean;
  isInitializing?: boolean;
}): ThreadAgentStatus | null {
  if (!hasActivity) return null;
  if (hasError || cloudStatus === "failed") {
    return { phase: "error", label: errorTitle ?? "Failed" };
  }
  if (pendingPermissionCount > 0) {
    return { phase: "needs_input", label: "Needs input" };
  }
  if (isPromptPending || isInitializing) {
    return { phase: "active", label: "Working…" };
  }
  return null;
}

export function shouldSuspendThreadSession({
  isCloud,
  hasRun,
  hasSession,
}: {
  isCloud: boolean;
  hasRun: boolean;
  hasSession: boolean;
}): boolean {
  return !isCloud && !hasRun && !hasSession;
}
