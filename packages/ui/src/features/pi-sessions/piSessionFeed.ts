import type {
  AgentSessionEvent,
  RpcClient,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";

export type PiEntries = Awaited<ReturnType<RpcClient["getEntries"]>>;
export type PiEntry = SessionEntry;
export type PiEvent = AgentSessionEvent;
export type PiMessage = Extract<PiEntry, { type: "message" }>["message"];

export interface PiLiveFeed {
  streamingMessage: PiMessage | null;
  liveMessages: PiMessage[];
}

export const emptyLiveFeed: PiLiveFeed = {
  streamingMessage: null,
  liveMessages: [],
};

export function mergeEntries(
  previous: PiEntries | undefined,
  next: PiEntries,
): PiEntries {
  if (!previous) {
    return next;
  }

  const knownIds = new Set(previous.entries.map((entry) => entry.id));
  const newEntries = next.entries.filter((entry) => !knownIds.has(entry.id));

  return { ...next, entries: [...previous.entries, ...newEntries] };
}

export function applyPiEvent(feed: PiLiveFeed, event: PiEvent): PiLiveFeed {
  if (event.type === "message_start") {
    if (event.message.role === "user") {
      return { ...feed, liveMessages: [...feed.liveMessages, event.message] };
    }
    if (event.message.role === "assistant") {
      return { ...feed, streamingMessage: event.message };
    }
    return feed;
  }

  if (event.type === "message_update" && event.message.role === "assistant") {
    return { ...feed, streamingMessage: event.message };
  }

  if (event.type === "message_end" && event.message.role === "assistant") {
    return {
      streamingMessage: null,
      liveMessages: [...feed.liveMessages, event.message],
    };
  }

  return feed;
}

/**
 * Serializes incremental entry fetches: at most one in flight, and a sync
 * requested mid-flight runs again afterwards instead of racing it. Each pass
 * fetches entries after the last known id and appends only unseen ones.
 */
export class PiEntriesSyncer {
  private current: PiEntries | undefined;
  private syncing = false;
  private requested = false;

  constructor(
    private readonly fetchEntries: (since?: string) => Promise<PiEntries>,
    private readonly onUpdate: (entries: PiEntries) => void,
  ) {}

  seed(entries: PiEntries | undefined): void {
    this.current = entries;
  }

  async sync(): Promise<void> {
    if (this.syncing) {
      this.requested = true;
      return;
    }

    this.syncing = true;
    try {
      do {
        this.requested = false;
        const since = this.current?.entries.at(-1)?.id;
        const next = await this.fetchEntries(since);
        this.current = mergeEntries(this.current, next);
        this.onUpdate(this.current);
      } while (this.requested);
    } finally {
      this.syncing = false;
    }
  }
}
