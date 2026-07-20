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

/**
 * Agent rows are authorless by design, so anything reading `author` alone sees
 * nobody and calls them "Unknown". `author_kind` is the only thing that says
 * the agent wrote it.
 */
export function isAgentThreadMessage(message: {
  author_kind?: string;
}): boolean {
  return message.author_kind === "agent";
}

/**
 * The durable thread messages worth rendering, given the run whose turns the
 * viewer is already watching stream.
 *
 * The backend posts every agent turn as a durable `turn_complete` row carrying
 * `payload.run_id` so a client streaming that run can drop one copy. We drop
 * the durable row rather than the live turn: the streamed one is what the
 * reader watched arrive, and swapping it for the server's copy at the end would
 * make the message jump. Anyone without that session — a teammate, or a run on
 * another machine — has no live turn to collide with, so they keep the durable
 * row and see the same conversation from the other side.
 */
export function visibleThreadMessages<
  T extends {
    author_kind?: string;
    event?: string;
    payload?: Record<string, unknown>;
  },
>(messages: readonly T[], streamingRunId: string | undefined): T[] {
  if (!streamingRunId) return [...messages];
  return messages.filter((message) => {
    if (message.event !== "turn_complete") return true;
    const runId = message.payload?.run_id;
    // A row with no run id can't be matched to the live turn; keeping a
    // possible duplicate beats silently dropping the only copy.
    return typeof runId !== "string" || runId !== streamingRunId;
  });
}
