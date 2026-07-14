import {
  markdownCrc,
  mergeNotebookMarkdownChanges,
  type TextChange,
  tryApplyTextChanges,
} from "./markdown-notebook/collaboration";

// Debounce for pushing local edits to the server, mirroring the PostHog
// webapp's notebookLogic (MARKDOWN_SYNC_DELAY / MARKDOWN_SYNC_MAX_DELAY):
// each keystroke defers the save by SYNC_DELAY_MS, but a continuous typing
// run still saves at least every SYNC_MAX_DELAY_MS.
const SYNC_DELAY_MS = 400;
const SYNC_MAX_DELAY_MS = 1500;
const RETRY_DELAY_MS = 5000;

export type NotebookSyncStatus = "saved" | "dirty" | "saving" | "error";

export interface NotebookMarkdownUpdate {
  version: number;
  diff: TextChange[];
  base_crc?: number | null;
}

/** A markdown update from the collab SSE stream (or a 409 conflict body). */
export interface NotebookRemoteUpdateEvent {
  /** Notebook version this event produces. */
  version: number;
  /** UTF-16 span changes transforming version-1 → version; absent means "reload". */
  diff?: TextChange[];
  /** CRC-32 of the base markdown; mismatch means our base diverged — reload. */
  baseCrc?: number | null;
  /** Saving client's id, used to skip self-echo. */
  clientId?: string | null;
}

export type NotebookSyncSaveResult =
  | { status: "saved"; markdown: string; version: number }
  | {
      status: "conflict";
      serverVersion: number;
      updates: NotebookMarkdownUpdate[];
    }
  | { status: "gone" };

export interface NotebookSyncDeps {
  /** Versioned save against the collab markdown_save endpoint. */
  saveMarkdown(input: {
    clientId: string;
    version: number;
    markdown: string;
    nodeId: string;
  }): Promise<NotebookSyncSaveResult>;
  /** Full refetch of the notebook, for when a missed range can't be replayed. */
  reload(): Promise<{
    markdown: string;
    version: number;
    nodeId: string | null;
  }>;
  /**
   * Canonical server content changed (save echo folded in, conflict replay, or
   * reload). Feed this to the editor's `remoteValue`/`remoteVersion` props —
   * the editor 3-way-merges it over any in-flight local typing itself.
   */
  onRemoteContent(remote: { markdown: string; version: number }): void;
  onStatusChange(status: NotebookSyncStatus): void;
}

/**
 * Autosave + optimistic-concurrency engine for one markdown notebook.
 *
 * Framework-free replication of the markdown slice of the PostHog webapp's
 * notebookLogic: debounced saves against `collab/markdown_save/`, and on a 409
 * the missed remote diffs are replayed over our baseline (CRC-checked), local
 * edits are 3-way-merged over the reconstructed server state, and the merge is
 * retried against the new version. A 410 (or a replay that doesn't fit our
 * baseline) falls back to a full reload; the editor merges local edits over
 * the fresh server state via `remoteValue`.
 */
export class NotebookSyncEngine {
  readonly clientId: string;

  private baseMarkdown: string;
  private baseVersion: number;
  private nodeId: string;
  private localMarkdown: string;

  private timer: ReturnType<typeof setTimeout> | null = null;
  private firstDirtyAt: number | null = null;
  private saving = false;
  private reloading = false;
  private disposed = false;
  private status: NotebookSyncStatus = "saved";
  /**
   * Remote stream events that arrived while a save or reload was in flight.
   * lastEventId has already advanced past them, so dropping them would leave
   * us permanently stale — they replay (version-sorted) once the operation
   * settles.
   */
  private pendingRemoteEvents: NotebookRemoteUpdateEvent[] = [];

  constructor(
    initial: { markdown: string; version: number; nodeId: string },
    private readonly deps: NotebookSyncDeps,
    clientId?: string,
  ) {
    this.baseMarkdown = initial.markdown;
    this.baseVersion = initial.version;
    this.nodeId = initial.nodeId;
    this.localMarkdown = initial.markdown;
    this.clientId = clientId ?? globalThis.crypto.randomUUID();
  }

  get version(): number {
    return this.baseVersion;
  }

  /** The editor emitted a new document. */
  handleChange(markdown: string): void {
    if (this.disposed) return;
    this.localMarkdown = markdown;
    if (markdown === this.baseMarkdown) {
      // Typed back to the saved state (or a remote merge echoed) — nothing to
      // push, but leave any scheduled flush alone; it will no-op.
      this.setStatus(this.saving ? "saving" : "saved");
      return;
    }
    this.setStatus(this.saving ? "saving" : "dirty");
    this.schedule(SYNC_DELAY_MS);
  }

  /**
   * A collab-stream `update` event arrived. Mirrors the webapp notebookLogic's
   * `handleMarkdownStreamEvent`: skip own echoes and stale versions, queue
   * while a save/reload is in flight, apply exact next-version diffs directly
   * (CRC-guarded), and fall back to a full reload for anything else (version
   * gap, oversized diff omitted by the server, or a diff that doesn't fit our
   * baseline).
   */
  applyRemoteUpdate(event: NotebookRemoteUpdateEvent): void {
    if (this.disposed) return;
    if (event.clientId && event.clientId === this.clientId) {
      // Our own save echoing back; the save response already advanced state.
      return;
    }
    if (event.version <= this.baseVersion) return;
    if (this.saving || this.reloading) {
      this.pendingRemoteEvents.push(event);
      return;
    }

    if (event.diff && event.version === this.baseVersion + 1) {
      const baseMatches =
        typeof event.baseCrc !== "number" ||
        markdownCrc(this.baseMarkdown) === event.baseCrc;
      const next = baseMatches
        ? tryApplyTextChanges(this.baseMarkdown, event.diff)
        : null;
      if (next !== null) {
        // Diffs are exact version transitions, so the result is canonical
        // server state — no GET needed.
        const previousBase = this.baseMarkdown;
        const snapshot = this.localMarkdown;
        this.baseMarkdown = next;
        this.baseVersion = event.version;
        this.deps.onRemoteContent({ markdown: next, version: event.version });
        // Rebase any unsaved local edits over the new server state, like the
        // 409 path. If the user keeps typing, the editor's own merge of
        // remoteValue supersedes this via onChange.
        this.localMarkdown =
          snapshot === previousBase
            ? next
            : mergeNotebookMarkdownChanges({
                baseMarkdown: previousBase,
                localMarkdown: snapshot,
                remoteMarkdown: next,
              }).mergedMarkdown;
        if (this.localMarkdown !== this.baseMarkdown) {
          this.setStatus("dirty");
          this.schedule(0);
        } else {
          this.firstDirtyAt = null;
          this.setStatus("saved");
        }
        return;
      }
    }

    // Version gap, diff-less event, or a diff that doesn't fit our base:
    // full reload, which also resets the baseline.
    this.reloadAndRebase().catch(() => {
      // Reload failure (network): stay on the current baseline; the next
      // stream event or save attempt triggers another reload.
      this.setStatus("error");
    });
  }

  /** Push any pending edit immediately (e.g. on unmount). */
  flushNow(): void {
    if (this.disposed) return;
    this.clearTimer();
    void this.flush();
  }

  dispose(options?: { flush?: boolean }): void {
    if (this.disposed) return;
    if (options?.flush && this.localMarkdown !== this.baseMarkdown) {
      this.clearTimer();
      // Deliberately not awaited: the component is unmounting; the request
      // outlives it and the server is the durable side.
      void this.flush({ evenIfDisposed: true });
    }
    this.disposed = true;
    this.clearTimer();
  }

  private setStatus(status: NotebookSyncStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.deps.onStatusChange(status);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private schedule(delayMs: number): void {
    const now = Date.now();
    if (this.firstDirtyAt === null) {
      this.firstDirtyAt = now;
    }
    // A typing run keeps pushing the save out, but never past the max delay
    // from the first unsaved edit.
    const cap = Math.max(0, this.firstDirtyAt + SYNC_MAX_DELAY_MS - now);
    const delay = Math.min(delayMs, cap);
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, delay);
  }

  private async flush(options?: { evenIfDisposed?: boolean }): Promise<void> {
    if (this.disposed && !options?.evenIfDisposed) return;
    if (this.saving) {
      return;
    }
    const snapshot = this.localMarkdown;
    if (snapshot === this.baseMarkdown) {
      this.firstDirtyAt = null;
      this.setStatus("saved");
      return;
    }

    this.saving = true;
    this.setStatus("saving");
    try {
      const result = await this.deps.saveMarkdown({
        clientId: this.clientId,
        version: this.baseVersion,
        markdown: snapshot,
        nodeId: this.nodeId,
      });

      if (result.status === "saved") {
        this.baseMarkdown = result.markdown;
        this.baseVersion = result.version;
        this.firstDirtyAt = null;
        this.deps.onRemoteContent({
          markdown: result.markdown,
          version: result.version,
        });
      } else if (result.status === "conflict") {
        this.handleConflict(snapshot, result);
      } else {
        await this.reloadAndRebase();
      }
    } catch {
      // Network or server failure: keep the edit, surface the state, retry.
      this.setStatus("error");
      this.saving = false;
      this.drainPendingRemoteEvents();
      if (!this.disposed) this.schedule(RETRY_DELAY_MS);
      return;
    }
    this.saving = false;
    this.drainPendingRemoteEvents();

    if (this.localMarkdown !== this.baseMarkdown) {
      // Either more typing landed during the request or a conflict merge left
      // us ahead of the server — push again without waiting for a keystroke.
      if (!this.disposed) this.schedule(0);
      this.setStatus("dirty");
    } else {
      this.firstDirtyAt = null;
      this.setStatus("saved");
    }
  }

  /**
   * 409: reconstruct the server's markdown by replaying the missed diffs over
   * our baseline (guarded by CRCs), then 3-way-merge our local edit over it.
   * Mirrors notebookLogic's conflict branch, including saving the merged
   * result eagerly rather than waiting for the editor to re-emit.
   */
  private handleConflict(
    snapshot: string,
    result: Extract<NotebookSyncSaveResult, { status: "conflict" }>,
  ): void {
    let serverMarkdown: string | null = this.baseMarkdown;
    for (const update of result.updates) {
      if (
        typeof update.base_crc === "number" &&
        markdownCrc(serverMarkdown) !== update.base_crc
      ) {
        serverMarkdown = null;
        break;
      }
      serverMarkdown = tryApplyTextChanges(serverMarkdown, update.diff);
      if (serverMarkdown === null) break;
    }

    if (serverMarkdown === null) {
      // Replay didn't fit our baseline — reload; the editor merges local
      // edits over the fresh server state via remoteValue.
      void this.reloadAndRebase();
      return;
    }

    const merge = mergeNotebookMarkdownChanges({
      baseMarkdown: this.baseMarkdown,
      localMarkdown: snapshot,
      remoteMarkdown: serverMarkdown,
    });
    this.baseMarkdown = serverMarkdown;
    this.baseVersion = result.serverVersion;
    this.deps.onRemoteContent({
      markdown: serverMarkdown,
      version: result.serverVersion,
    });
    if (
      merge.mergedMarkdown !== serverMarkdown &&
      this.localMarkdown === snapshot
    ) {
      // No newer keystrokes landed during the request, so our merge is the
      // freshest document; adopt it as the local state and let the follow-up
      // flush (scheduled by our caller) push it. If the user kept typing, the
      // editor's own merge of remoteValue supersedes ours via onChange.
      this.localMarkdown = merge.mergedMarkdown;
    }
  }

  private async reloadAndRebase(): Promise<void> {
    this.reloading = true;
    try {
      const server = await this.deps.reload();
      // No unsaved local edits: follow the baseline so we don't misread the
      // pre-reload document as dirty and push stale content back. Unsaved
      // edits stay put — the editor merges them over remoteValue and re-emits.
      if (this.localMarkdown === this.baseMarkdown) {
        this.localMarkdown = server.markdown;
      }
      this.baseMarkdown = server.markdown;
      this.baseVersion = server.version;
      if (server.nodeId) this.nodeId = server.nodeId;
      this.deps.onRemoteContent({
        markdown: server.markdown,
        version: server.version,
      });
    } finally {
      this.reloading = false;
      this.drainPendingRemoteEvents();
    }
  }

  private drainPendingRemoteEvents(): void {
    if (this.pendingRemoteEvents.length === 0) return;
    const pending = [...this.pendingRemoteEvents].sort(
      (a, b) => a.version - b.version,
    );
    this.pendingRemoteEvents = [];
    for (const event of pending) {
      // Re-enters the normal path: stale entries drop, and if another
      // save/reload started mid-drain the rest re-queue.
      this.applyRemoteUpdate(event);
    }
  }
}
