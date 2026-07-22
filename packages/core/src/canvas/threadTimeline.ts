export interface ThreadHumanMessage<T = unknown> {
  id: string;
  content: string;
  createdAt: string;
  forwardedToAgent?: boolean;
  value?: T;
}

export type ThreadTimelineRow<T = unknown> = {
  kind: "human";
  timestamp: number;
  message: ThreadHumanMessage<T>;
};

function parsedTimestamp(timestamp: string): number {
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

export function buildThreadTimeline<T>({
  humanMessages,
}: {
  humanMessages: ThreadHumanMessage<T>[];
}): ThreadTimelineRow<T>[] {
  return humanMessages
    .map(
      (message): ThreadTimelineRow<T> => ({
        kind: "human",
        timestamp: parsedTimestamp(message.createdAt),
        message,
      }),
    )
    .sort((left, right) => left.timestamp - right.timestamp);
}

const AGENT_MENTION_PATTERN = /(^|\s)@agent\b/i;

export function hasAgentMention(content: string): boolean {
  return AGENT_MENTION_PATTERN.test(content);
}
