import type { PostHogAPIClient } from "@posthog/api-client/posthog-client";
import type { TextChange } from "./markdown-notebook/collaboration";
import type {
  MarkdownNotebookCaretPosition,
  RemoteNotebookCaret,
} from "./markdown-notebook/remoteCarets";

// Reconnect after this long when the stream errors; a clean server close
// (the backend caps each connection at ~5 minutes) reconnects immediately.
const RECONNECT_DELAY_MS = 2000;
/** Remote carets older than this stop rendering; senders heartbeat well within it. */
const PRESENCE_TTL_MS = 30_000;
const PRESENCE_PRUNE_INTERVAL_MS = 5_000;
const PRESENCE_HEARTBEAT_MS = 10_000;
/** Client-side debounce for caret pings, the floor for caret latency. */
const PRESENCE_PUBLISH_DEBOUNCE_MS = 250;

// Stable per-user caret colors: index by user id so a user keeps their color
// across sessions and clients.
const PRESENCE_COLORS = [
  "#f94144",
  "#f3722c",
  "#f8961e",
  "#f9c74f",
  "#90be6d",
  "#43aa8b",
  "#577590",
  "#9b5de5",
];

/** Caret position in the API's wire shape (`snake_case`, see NotebookCollabCursorSerializer). */
interface NotebookCollabCursor {
  head?: number;
  node_index?: number;
  offset?: number;
  list_item_index?: number;
}

/** Latest known caret of another client, from presence pings or update events. */
interface RemotePresenceEntry {
  clientId: string;
  userId: number;
  userName: string;
  version: number;
  cursor: NotebookCollabCursor;
  lastSeenAt: number;
}

/** The slice of `NotebookSyncEngine` the stream controller drives. */
export interface NotebookStreamEngine {
  applyRemoteUpdate(event: {
    version: number;
    diff?: TextChange[];
    baseCrc?: number | null;
    clientId?: string | null;
  }): void;
  /** Current known server version, sent with presence pings. */
  readonly version: number;
}

export interface NotebookStreamControllerOptions {
  shortId: string;
  /** Must match the sync engine's clientId so own save echoes are skipped. */
  clientId: string;
  engine: NotebookStreamEngine;
  getClient: () => PostHogAPIClient | null;
  /** Called with the full remote caret set whenever it changes. */
  onPresence: (carets: RemoteNotebookCaret[]) => void;
}

function parseCaretPosition(
  cursor: NotebookCollabCursor,
): MarkdownNotebookCaretPosition | null {
  if (typeof cursor.node_index !== "number") return null;
  return {
    nodeIndex: cursor.node_index,
    offset: cursor.offset,
    listItemIndex: cursor.list_item_index,
  };
}

/**
 * Realtime side of one markdown notebook: subscribes to the collab SSE stream
 * (`collab/stream`), feeds accepted remote updates into the sync engine, and
 * handles presence in both directions — remote carets in (TTL-pruned latest
 * ping per client), our caret out (debounced `collab/presence` POSTs with a
 * heartbeat). Framework-free, like `NotebookSyncEngine`.
 *
 * Connects on construction and reconnects until `dispose()`: immediately on a
 * clean server close (the backend caps streams at ~5 minutes), after a fixed
 * delay on errors, resuming from the last seen event id.
 */
export class NotebookStreamController {
  private readonly abort = new AbortController();
  private disposed = false;
  private lastEventId: string | undefined;

  private readonly presence = new Map<string, RemotePresenceEntry>();
  private readonly pruneInterval: ReturnType<typeof setInterval>;
  private readonly heartbeatInterval: ReturnType<typeof setInterval>;

  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private publishTimer: ReturnType<typeof setTimeout> | null = null;
  private lastCaret: MarkdownNotebookCaretPosition | null = null;
  private lastSentCaret: string | null = null;
  private lastSentCaretAt = 0;

  constructor(private readonly options: NotebookStreamControllerOptions) {
    this.pruneInterval = setInterval(
      () => this.pruneStalePresence(),
      PRESENCE_PRUNE_INTERVAL_MS,
    );
    // Re-announce the caret while idle so it outlives the receivers' TTL.
    this.heartbeatInterval = setInterval(() => {
      if (this.lastCaret) this.schedulePublish(this.lastCaret);
    }, PRESENCE_HEARTBEAT_MS);
    void this.runConnectLoop();
  }

  /**
   * The local caret moved (null: the selection left the notebook). Publishes
   * debounced, skipping positions already announced within the heartbeat
   * window.
   */
  publishCaret(position: MarkdownNotebookCaretPosition | null): void {
    if (this.disposed) return;
    this.lastCaret = position;
    if (!position) {
      // No "presence gone" endpoint exists; receivers TTL-prune us instead.
      this.clearPublishTimer();
      return;
    }
    this.schedulePublish(position);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abort.abort();
    clearInterval(this.pruneInterval);
    clearInterval(this.heartbeatInterval);
    this.clearPublishTimer();
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private async runConnectLoop(): Promise<void> {
    while (!this.disposed) {
      const client = this.options.getClient();
      if (!client) {
        await this.delay(RECONNECT_DELAY_MS);
        continue;
      }
      try {
        await client.notebookCollabStream(this.options.shortId, {
          lastEventId: this.lastEventId,
          signal: this.abort.signal,
          onEvent: (event) => this.handleEvent(event),
        });
        // Clean end — the server's per-connection lifetime cap. Reconnect
        // immediately; lastEventId resumes where we left off.
      } catch {
        if (this.disposed) return;
        await this.delay(RECONNECT_DELAY_MS);
      }
    }
  }

  private handleEvent(event: {
    id?: string;
    event: string;
    data: string;
  }): void {
    if (this.disposed) return;
    if (event.id) {
      // Presence frames carry no id, so they never advance the resume cursor.
      this.lastEventId = event.id;
    }

    if (event.event === "presence") {
      const payload = this.parseJson(event.data);
      const entry = payload && this.parsePresencePayload(payload);
      if (entry && entry.clientId !== this.options.clientId) {
        this.upsertPresence(entry);
      }
      return;
    }

    if (event.event !== "update") {
      // `step` frames are the legacy TipTap protocol; `error` frames precede
      // a server-side close that the connect loop already handles.
      return;
    }

    // `-1` stream entries carry an explicit `version`; `-0` entries derive it
    // from the id prefix (`<version>-<seq>`).
    let version = event.id ? parseInt(event.id.split("-")[0], 10) : NaN;
    let diff: TextChange[] | undefined;
    let baseCrc: number | null | undefined;
    let clientId: string | undefined;

    const payload = this.parseJson(event.data);
    if (payload) {
      if (typeof payload.version === "number") version = payload.version;
      if (Array.isArray(payload.diff)) diff = payload.diff as TextChange[];
      if (typeof payload.base_crc === "number") baseCrc = payload.base_crc;
      if (typeof payload.client_id === "string") clientId = payload.client_id;

      // Saves piggyback the author's caret so it moves in the same paint as
      // the text change lands.
      const presence = this.parsePresencePayload(payload);
      if (presence && presence.clientId !== this.options.clientId) {
        this.upsertPresence({
          ...presence,
          version: Number.isFinite(version) ? version : presence.version,
        });
      }
    }

    if (!Number.isFinite(version) || version <= 0) return;
    if (clientId && clientId === this.options.clientId) {
      // Our own save echoing back; the save response already advanced the
      // engine (which also guards against this itself).
      return;
    }
    this.options.engine.applyRemoteUpdate({ version, diff, baseCrc, clientId });
  }

  private parseJson(data: string): Record<string, unknown> | null {
    if (!data) return null;
    try {
      const parsed: unknown = JSON.parse(data);
      return typeof parsed === "object" && parsed !== null
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }

  private parsePresencePayload(
    payload: Record<string, unknown>,
  ): Omit<RemotePresenceEntry, "lastSeenAt"> | null {
    if (
      typeof payload.client_id !== "string" ||
      typeof payload.user_id !== "number" ||
      typeof payload.user_name !== "string" ||
      typeof payload.cursor !== "object" ||
      payload.cursor === null
    ) {
      return null;
    }
    return {
      clientId: payload.client_id,
      userId: payload.user_id,
      userName: payload.user_name,
      version: typeof payload.version === "number" ? payload.version : 0,
      cursor: payload.cursor as NotebookCollabCursor,
    };
  }

  private upsertPresence(entry: Omit<RemotePresenceEntry, "lastSeenAt">): void {
    this.presence.set(entry.clientId, { ...entry, lastSeenAt: Date.now() });
    this.emitPresence();
  }

  private pruneStalePresence(): void {
    const cutoff = Date.now() - PRESENCE_TTL_MS;
    let changed = false;
    for (const [clientId, entry] of this.presence) {
      if (entry.lastSeenAt < cutoff) {
        this.presence.delete(clientId);
        changed = true;
      }
    }
    if (changed) this.emitPresence();
  }

  private emitPresence(): void {
    if (this.disposed) return;
    const carets: RemoteNotebookCaret[] = [];
    for (const entry of this.presence.values()) {
      const position = parseCaretPosition(entry.cursor);
      if (!position) continue;
      carets.push({
        clientId: entry.clientId,
        userName: entry.userName,
        color: PRESENCE_COLORS[Math.abs(entry.userId) % PRESENCE_COLORS.length],
        position,
        version: entry.version,
      });
    }
    this.options.onPresence(carets);
  }

  private clearPublishTimer(): void {
    if (this.publishTimer !== null) {
      clearTimeout(this.publishTimer);
      this.publishTimer = null;
    }
  }

  private schedulePublish(position: MarkdownNotebookCaretPosition): void {
    this.clearPublishTimer();
    this.publishTimer = setTimeout(() => {
      this.publishTimer = null;
      void this.publishNow(position);
    }, PRESENCE_PUBLISH_DEBOUNCE_MS);
  }

  private async publishNow(
    position: MarkdownNotebookCaretPosition,
  ): Promise<void> {
    if (this.disposed) return;
    const client = this.options.getClient();
    if (!client) return;

    // Skip unchanged positions between heartbeats: selection listeners fire on
    // scroll and re-renders without the caret actually moving.
    const serialized = JSON.stringify(position);
    if (
      this.lastSentCaret === serialized &&
      Date.now() - this.lastSentCaretAt < PRESENCE_HEARTBEAT_MS
    ) {
      return;
    }

    try {
      await client.notebookPublishPresence(this.options.shortId, {
        client_id: this.options.clientId,
        version: Math.max(0, this.options.engine.version),
        cursor: {
          node_index: position.nodeIndex,
          offset: position.offset,
          list_item_index: position.listItemIndex,
        },
      });
      this.lastSentCaret = serialized;
      this.lastSentCaretAt = Date.now();
    } catch {
      // Presence is lossy by design; the next ping self-heals.
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        resolve();
      }, ms);
    });
  }
}
