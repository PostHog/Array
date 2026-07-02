import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { serializeError } from "@posthog/shared";
import type { SessionContext } from "./otel-log-writer";
import type { PostHogAPIClient } from "./posthog-api";
import type { StoredNotification } from "./types";
import { Logger } from "./utils/logger";

export interface SessionLogWriterOptions {
  /** PostHog API client for log persistence */
  posthogAPI?: PostHogAPIClient;
  /** Logger instance */
  logger?: Logger;
  /** Local cache path for instant log loading (e.g., ~/.posthog-code) */
  localCachePath?: string;
}

interface ChunkBuffer {
  text: string;
  firstTimestamp: string;
}

interface SessionState {
  context: SessionContext;
  chunkBuffer?: ChunkBuffer;
  lastAgentMessage?: string;
  currentTurnMessages: string[];
}

export class SessionLogWriter {
  private static readonly FLUSH_DEBOUNCE_MS = 500;
  private static readonly FLUSH_MAX_INTERVAL_MS = 5000;
  private static readonly MAX_FLUSH_RETRIES = 10;
  private static readonly MAX_RETRY_DELAY_MS = 30_000;
  private static readonly SESSIONS_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

  private posthogAPI?: PostHogAPIClient;
  private pendingEntries: Map<string, StoredNotification[]> = new Map();
  private flushTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private lastFlushAttemptTime: Map<string, number> = new Map();
  private retryCounts: Map<string, number> = new Map();
  private sessions: Map<string, SessionState> = new Map();
  private flushQueues: Map<string, Promise<void>> = new Map();

  private logger: Logger;
  private localCachePath?: string;

  constructor(options: SessionLogWriterOptions = {}) {
    this.posthogAPI = options.posthogAPI;
    this.localCachePath = options.localCachePath;
    this.logger =
      options.logger ??
      new Logger({ debug: false, prefix: "[SessionLogWriter]" });
  }

  async flushAll(): Promise<void> {
    // Coalesce any in-progress chunk buffers before the final flush
    // During normal operation, chunks are coalesced when the next non-chunk
    // event arrives, but on shutdown there may be no subsequent event
    const flushPromises: Promise<void>[] = [];
    for (const [sessionId, session] of this.sessions) {
      this.emitCoalescedMessage(sessionId, session);
      flushPromises.push(this.flush(sessionId));
    }
    await Promise.all(flushPromises);
  }

  register(sessionId: string, context: SessionContext): void {
    if (this.sessions.has(sessionId)) {
      return;
    }

    this.sessions.set(sessionId, { context, currentTurnMessages: [] });

    this.lastFlushAttemptTime.set(sessionId, Date.now());

    if (this.localCachePath) {
      const sessionDir = path.join(
        this.localCachePath,
        "sessions",
        context.runId,
      );
      try {
        fs.mkdirSync(sessionDir, { recursive: true });
      } catch (error) {
        this.logger.warn("Failed to create local cache directory", {
          sessionDir,
          error,
        });
      }
    }
  }

  isRegistered(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  appendRawLine(sessionId: string, line: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      this.logger.warn("appendRawLine called for unregistered session", {
        sessionId,
      });
      return;
    }

    try {
      const message = JSON.parse(line);
      const timestamp = new Date().toISOString();

      // Check if this is an agent_message_chunk event
      if (this.isAgentMessageChunk(message)) {
        const text = this.extractChunkText(message);
        if (text) {
          if (!session.chunkBuffer) {
            session.chunkBuffer = { text, firstTimestamp: timestamp };
          } else {
            session.chunkBuffer.text += text;
          }
        }
        // Don't emit chunk events
        return;
      }

      // Non-chunk event: flush any buffered chunks first.
      // If this is a direct agent_message AND there are buffered chunks,
      // the direct message supersedes the partial chunks
      if (this.isDirectAgentMessage(message) && session.chunkBuffer) {
        session.chunkBuffer = undefined;
      } else {
        this.emitCoalescedMessage(sessionId, session);
      }

      const nonChunkAgentText = this.extractAgentMessageText(message);
      if (nonChunkAgentText) {
        session.lastAgentMessage = nonChunkAgentText;
        session.currentTurnMessages.push(nonChunkAgentText);
      }

      const entry: StoredNotification = {
        type: "notification",
        timestamp,
        notification: message,
      };

      this.writeToLocalCache(sessionId, entry);

      if (this.posthogAPI) {
        const pending = this.pendingEntries.get(sessionId) ?? [];
        pending.push(entry);
        this.pendingEntries.set(sessionId, pending);
        this.scheduleFlush(sessionId);
      }
    } catch {
      this.logger.warn("Failed to parse raw line for persistence", {
        taskId: session.context.taskId,
        runId: session.context.runId,
        lineLength: line.length,
      });
    }
  }

  async flush(
    sessionId: string,
    { coalesce = false }: { coalesce?: boolean } = {},
  ): Promise<void> {
    if (coalesce) {
      const session = this.sessions.get(sessionId);
      if (session) {
        this.emitCoalescedMessage(sessionId, session);
      }
    }

    // Serialize flushes per session
    const prev = this.flushQueues.get(sessionId) ?? Promise.resolve();
    const next = prev.catch(() => {}).then(() => this._doFlush(sessionId));
    this.flushQueues.set(sessionId, next);
    next.finally(() => {
      if (this.flushQueues.get(sessionId) === next) {
        this.flushQueues.delete(sessionId);
      }
    });
    return next;
  }

  private async _doFlush(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      this.logger.warn("flush: no session found", { sessionId });
      return;
    }

    const pending = this.pendingEntries.get(sessionId);
    if (!this.posthogAPI || !pending?.length) {
      return;
    }

    this.pendingEntries.delete(sessionId);
    const timeout = this.flushTimeouts.get(sessionId);
    if (timeout) {
      clearTimeout(timeout);
      this.flushTimeouts.delete(sessionId);
    }

    this.lastFlushAttemptTime.set(sessionId, Date.now());

    try {
      await this.posthogAPI.appendTaskRunLog(
        session.context.taskId,
        session.context.runId,
        pending,
      );
      this.retryCounts.set(sessionId, 0);
    } catch (error) {
      const retryCount = (this.retryCounts.get(sessionId) ?? 0) + 1;
      this.retryCounts.set(sessionId, retryCount);

      if (retryCount >= SessionLogWriter.MAX_FLUSH_RETRIES) {
        this.logger.error(
          `Dropping ${pending.length} session log entries after ${retryCount} failed flush attempts`,
          {
            taskId: session.context.taskId,
            runId: session.context.runId,
            maxRetries: SessionLogWriter.MAX_FLUSH_RETRIES,
            errorDetail: serializeError(error),
          },
        );
        this.retryCounts.set(sessionId, 0);
      } else {
        if (retryCount === 1) {
          this.logger.warn(
            `Failed to persist session logs, will retry (up to ${SessionLogWriter.MAX_FLUSH_RETRIES} attempts)`,
            {
              taskId: session.context.taskId,
              runId: session.context.runId,
              error: error instanceof Error ? error.message : String(error),
            },
          );
        }
        const currentPending = this.pendingEntries.get(sessionId) ?? [];
        this.pendingEntries.set(sessionId, [...pending, ...currentPending]);
        this.scheduleFlush(sessionId);
      }
    }
  }

  private getSessionUpdateType(
    message: Record<string, unknown>,
  ): string | undefined {
    if (message.method !== "session/update") return undefined;
    const params = message.params as Record<string, unknown> | undefined;
    const update = params?.update as Record<string, unknown> | undefined;
    return update?.sessionUpdate as string | undefined;
  }

  private isDirectAgentMessage(message: Record<string, unknown>): boolean {
    return this.getSessionUpdateType(message) === "agent_message";
  }

  private isAgentMessageChunk(message: Record<string, unknown>): boolean {
    return this.getSessionUpdateType(message) === "agent_message_chunk";
  }

  private extractChunkText(message: Record<string, unknown>): string {
    const params = message.params as Record<string, unknown> | undefined;
    const update = params?.update as Record<string, unknown> | undefined;
    const content = update?.content as
      | { type: string; text?: string }
      | undefined;
    if (content?.type === "text" && content.text) {
      return content.text;
    }
    return "";
  }

  private emitCoalescedMessage(sessionId: string, session: SessionState): void {
    if (!session.chunkBuffer) return;

    const { text, firstTimestamp } = session.chunkBuffer;
    session.chunkBuffer = undefined;
    session.lastAgentMessage = text;
    session.currentTurnMessages.push(text);

    const entry: StoredNotification = {
      type: "notification",
      timestamp: firstTimestamp,
      notification: {
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          update: {
            sessionUpdate: "agent_message",
            content: { type: "text", text },
          },
        },
      },
    };

    this.writeToLocalCache(sessionId, entry);

    if (this.posthogAPI) {
      const pending = this.pendingEntries.get(sessionId) ?? [];
      pending.push(entry);
      this.pendingEntries.set(sessionId, pending);
      this.scheduleFlush(sessionId);
    }
  }

  getLastAgentMessage(sessionId: string): string | undefined {
    return this.sessions.get(sessionId)?.lastAgentMessage;
  }

  getFullAgentResponse(sessionId: string): string | undefined {
    const session = this.sessions.get(sessionId);
    if (!session || session.currentTurnMessages.length === 0) return undefined;

    if (session.chunkBuffer) {
      this.logger.warn(
        "getFullAgentResponse called with non-empty chunk buffer",
        {
          sessionId,
          bufferedLength: session.chunkBuffer.text.length,
        },
      );
    }

    return session.currentTurnMessages.join("\n\n");
  }

  /**
   * Returns the ordered assistant text blocks for the current turn — one entry
   * per message between tool calls. The last entry is the text after the final
   * tool_use (the actual answer to the user).
   *
   * The Slack relay uses this so the backend can post only the last block
   * instead of every interim "Let me check…" narration.
   */
  getAgentResponseParts(sessionId: string): string[] | undefined {
    const session = this.sessions.get(sessionId);
    if (!session || session.currentTurnMessages.length === 0) return undefined;

    if (session.chunkBuffer) {
      this.logger.warn(
        "getAgentResponseParts called with non-empty chunk buffer",
        {
          sessionId,
          bufferedLength: session.chunkBuffer.text.length,
        },
      );
    }

    return [...session.currentTurnMessages];
  }

  resetTurnMessages(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.currentTurnMessages = [];
    }
  }

  private extractAgentMessageText(
    message: Record<string, unknown>,
  ): string | null {
    if (message.method !== "session/update") {
      return null;
    }

    const params = message.params as Record<string, unknown> | undefined;
    const update = params?.update as Record<string, unknown> | undefined;
    if (update?.sessionUpdate !== "agent_message") {
      return null;
    }

    const content = update.content as
      | { type?: string; text?: string }
      | undefined;
    if (content?.type === "text" && typeof content.text === "string") {
      const trimmed = content.text.trim();
      return trimmed.length > 0 ? trimmed : null;
    }

    if (typeof update.message === "string") {
      const trimmed = update.message.trim();
      return trimmed.length > 0 ? trimmed : null;
    }

    return null;
  }

  private scheduleFlush(sessionId: string): void {
    const existing = this.flushTimeouts.get(sessionId);
    if (existing) clearTimeout(existing);

    const retryCount = this.retryCounts.get(sessionId) ?? 0;
    const lastAttempt = this.lastFlushAttemptTime.get(sessionId) ?? 0;
    const elapsed = Date.now() - lastAttempt;

    let delay: number;
    if (retryCount > 0) {
      // Exponential backoff on retries: FLUSH_DEBOUNCE_MS * 2^retryCount, capped
      delay = Math.min(
        SessionLogWriter.FLUSH_DEBOUNCE_MS * 2 ** retryCount,
        SessionLogWriter.MAX_RETRY_DELAY_MS,
      );
    } else if (elapsed >= SessionLogWriter.FLUSH_MAX_INTERVAL_MS) {
      // If we've been accumulating for longer than the max interval, flush immediately
      delay = 0;
    } else {
      delay = SessionLogWriter.FLUSH_DEBOUNCE_MS;
    }

    const timeout = setTimeout(() => this.flush(sessionId), delay);
    this.flushTimeouts.set(sessionId, timeout);
  }

  private writeToLocalCache(
    sessionId: string,
    entry: StoredNotification,
  ): void {
    if (!this.localCachePath) return;

    const session = this.sessions.get(sessionId);
    if (!session) return;

    const logPath = path.join(
      this.localCachePath,
      "sessions",
      session.context.runId,
      "logs.ndjson",
    );

    try {
      fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`);
    } catch (error) {
      this.logger.warn("Failed to write to local cache", {
        taskId: session.context.taskId,
        runId: session.context.runId,
        logPath,
        error,
      });
    }
  }

  static async cleanupOldSessions(localCachePath: string): Promise<number> {
    const sessionsDir = path.join(localCachePath, "sessions");
    let deleted = 0;
    try {
      const entries = await fsp.readdir(sessionsDir);
      const now = Date.now();
      for (const entry of entries) {
        const entryPath = path.join(sessionsDir, entry);
        try {
          const stats = await fsp.stat(entryPath);
          if (
            stats.isDirectory() &&
            now - stats.birthtimeMs > SessionLogWriter.SESSIONS_MAX_AGE_MS
          ) {
            await fsp.rm(entryPath, { recursive: true, force: true });
            deleted++;
          }
        } catch {
          // Skip entries we can't stat
        }
      }
    } catch {
      // Sessions dir may not exist yet
    }
    return deleted;
  }
}
