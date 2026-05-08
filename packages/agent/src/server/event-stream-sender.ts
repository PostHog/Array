import { Buffer } from "node:buffer";
import type { Logger } from "../utils/logger";

interface TaskRunEventStreamSenderConfig {
  apiUrl: string;
  projectId: number;
  taskId: string;
  runId: string;
  token: string;
  logger: Logger;
  maxBufferedEvents?: number;
  flushDelayMs?: number;
  retryDelayMs?: number;
  requestTimeoutMs?: number;
  stopTimeoutMs?: number;
  maxBatchEvents?: number;
  maxBatchBytes?: number;
  maxEventBytes?: number;
}

interface EventEnvelope {
  seq: number;
  event: Record<string, unknown>;
}

interface IngestResponse {
  last_accepted_seq?: unknown;
}

const DEFAULT_MAX_BUFFERED_EVENTS = 20_000;
const DEFAULT_MAX_BATCH_EVENTS = 500;
const DEFAULT_MAX_BATCH_BYTES = 4_000_000;
const DEFAULT_MAX_EVENT_BYTES = 900_000;
const DEFAULT_FLUSH_DELAY_MS = 50;
const DEFAULT_RETRY_DELAY_MS = 1_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_STOP_TIMEOUT_MS = 30_000;

export class TaskRunEventStreamSender {
  private readonly ingestUrl: string;
  private readonly maxBufferedEvents: number;
  private readonly maxBatchEvents: number;
  private readonly maxBatchBytes: number;
  private readonly maxEventBytes: number;
  private readonly flushDelayMs: number;
  private readonly retryDelayMs: number;
  private readonly requestTimeoutMs: number;
  private readonly stopTimeoutMs: number;
  private sequence = 0;
  private bufferedEvents: EventEnvelope[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushPromise: Promise<void> | null = null;
  private stopPromise: Promise<void> | null = null;
  private stopped = false;
  private sequenceSynced = false;
  private transportCompleted = false;
  private droppedBeforeSequenceCount = 0;
  private bufferRevision = 0;

  constructor(private readonly config: TaskRunEventStreamSenderConfig) {
    const apiUrl = config.apiUrl.replace(/\/$/, "");
    this.ingestUrl = `${apiUrl}/api/projects/${config.projectId}/tasks/${encodeURIComponent(
      config.taskId,
    )}/runs/${encodeURIComponent(config.runId)}/event_stream/`;
    this.maxBufferedEvents =
      config.maxBufferedEvents ?? DEFAULT_MAX_BUFFERED_EVENTS;
    this.maxBatchEvents = config.maxBatchEvents ?? DEFAULT_MAX_BATCH_EVENTS;
    this.maxBatchBytes = config.maxBatchBytes ?? DEFAULT_MAX_BATCH_BYTES;
    this.maxEventBytes = config.maxEventBytes ?? DEFAULT_MAX_EVENT_BYTES;
    this.flushDelayMs = config.flushDelayMs ?? DEFAULT_FLUSH_DELAY_MS;
    this.retryDelayMs = config.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    this.requestTimeoutMs =
      config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.stopTimeoutMs = config.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS;
  }

  enqueue(event: Record<string, unknown>): void {
    if (this.stopped) return;

    if (!this.canAcceptEvent(event)) {
      return;
    }

    const envelope: EventEnvelope = {
      seq: ++this.sequence,
      event,
    };
    this.bufferedEvents.push(envelope);
    this.scheduleFlush();
  }

  async stop(): Promise<void> {
    if (this.stopPromise) {
      await this.stopPromise;
      return;
    }

    this.stopped = true;

    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    this.stopPromise = this.drainForStop();
    await this.stopPromise;
  }

  private scheduleFlush(delayMs = this.flushDelayMs): void {
    if (this.flushTimer || this.flushPromise || this.stopped) return;

    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, delayMs);
  }

  private async drainForStop(): Promise<void> {
    const startedAtMs = Date.now();
    const deadlineAtMs = startedAtMs + this.stopTimeoutMs;
    while (this.bufferedEvents.length > 0) {
      const previousLength = this.bufferedEvents.length;
      const previousRevision = this.bufferRevision;

      await this.flush();
      const madeProgress =
        this.bufferedEvents.length < previousLength ||
        this.bufferRevision !== previousRevision;

      if (!madeProgress && !(await this.waitBeforeStopRetry(deadlineAtMs))) {
        this.warnStopDeadlineReached(startedAtMs);
        return;
      }

      if (Date.now() >= deadlineAtMs && this.bufferedEvents.length > 0) {
        this.warnStopDeadlineReached(startedAtMs);
        return;
      }
    }

    while (!this.transportCompleted) {
      try {
        await this.completeTransport();
        return;
      } catch (error) {
        this.config.logger.warn(
          "Task run event ingest completion request failed",
          this.describeError(error),
        );
      }

      if (!(await this.waitBeforeStopRetry(deadlineAtMs))) {
        this.config.logger.warn(
          "Task run event ingest stop deadline reached before completing transport",
          {
            stopTimeoutMs: this.stopTimeoutMs,
            elapsedMs: Date.now() - startedAtMs,
          },
        );
        return;
      }
    }
  }

  private async flush(): Promise<boolean> {
    if (this.flushPromise) {
      await this.flushPromise.catch(() => undefined);
    }

    if (this.bufferedEvents.length === 0) {
      return true;
    }

    const previousBufferLength = this.bufferedEvents.length;
    const flushPromise = this.sendBufferedEvents();
    this.flushPromise = flushPromise;

    try {
      await flushPromise;
      return this.bufferedEvents.length < previousBufferLength;
    } catch (error) {
      this.config.logger.warn(
        "Task run event ingest request failed",
        this.describeError(error),
      );
      if (!this.stopped) {
        this.scheduleFlush(this.retryDelayMs);
      }
      return false;
    } finally {
      if (this.flushPromise === flushPromise) {
        this.flushPromise = null;
      }
      if (!this.stopped && this.bufferedEvents.length > 0) {
        this.scheduleFlush(0);
      }
    }
  }

  private async sendBufferedEvents(): Promise<void> {
    await this.syncSequenceWithServer();

    const body = this.buildBatchBody();
    const abortController = new AbortController();
    const timeout = setTimeout(() => {
      abortController.abort();
    }, this.requestTimeoutMs);

    let response: Response;
    try {
      response = await fetch(this.ingestUrl, {
        method: "POST",
        headers: this.buildHeaders(),
        body,
        signal: abortController.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const responseBody = await this.parseResponse(response);
    const lastAcceptedSeq = responseBody.parsed?.last_accepted_seq;
    if (typeof lastAcceptedSeq === "number") {
      const previousLength = this.bufferedEvents.length;
      this.bufferedEvents = this.bufferedEvents.filter(
        (event) => event.seq > lastAcceptedSeq,
      );
      if (this.bufferedEvents.length !== previousLength) {
        this.bufferRevision += 1;
      }
      if (response.status === 409) {
        this.rebaseBufferedEvents(lastAcceptedSeq);
      }
    }

    if (!response.ok) {
      throw new Error(
        `Event ingest returned HTTP ${response.status}: ${responseBody.text.slice(0, 300)}`,
      );
    }
  }

  private async completeTransport(): Promise<void> {
    await this.syncSequenceWithServer();

    const abortController = new AbortController();
    const timeout = setTimeout(() => {
      abortController.abort();
    }, this.requestTimeoutMs);

    let response: Response;
    try {
      response = await fetch(this.ingestUrl, {
        method: "POST",
        headers: {
          ...this.buildHeaders(),
          "X-PostHog-Event-Stream-Complete": "true",
          "X-PostHog-Event-Stream-Final-Seq": String(this.sequence),
        },
        body: "",
        signal: abortController.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const responseBody = await this.parseResponse(response);
    const lastAcceptedSeq = responseBody.parsed?.last_accepted_seq;
    if (
      typeof lastAcceptedSeq === "number" &&
      lastAcceptedSeq > this.sequence
    ) {
      this.sequence = lastAcceptedSeq;
    }

    if (!response.ok) {
      throw new Error(
        `Event ingest completion returned HTTP ${response.status}: ${responseBody.text.slice(0, 300)}`,
      );
    }
    this.transportCompleted = true;
  }

  private async waitBeforeStopRetry(deadlineAtMs: number): Promise<boolean> {
    const remainingMs = deadlineAtMs - Date.now();
    if (remainingMs <= 0) {
      return false;
    }

    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(this.retryDelayMs, remainingMs)),
    );
    return Date.now() < deadlineAtMs;
  }

  private warnStopDeadlineReached(startedAtMs: number): void {
    this.config.logger.warn(
      "Task run event ingest stop deadline reached before fully draining buffered events",
      {
        remaining: this.bufferedEvents.length,
        stopTimeoutMs: this.stopTimeoutMs,
        elapsedMs: Date.now() - startedAtMs,
      },
    );
  }

  private async syncSequenceWithServer(): Promise<void> {
    if (this.sequenceSynced) return;

    const abortController = new AbortController();
    const timeout = setTimeout(() => {
      abortController.abort();
    }, this.requestTimeoutMs);

    let response: Response;
    try {
      response = await fetch(this.ingestUrl, {
        method: "POST",
        headers: this.buildHeaders(),
        body: "",
        signal: abortController.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const responseBody = await this.parseResponse(response);

    if (!response.ok) {
      throw new Error(
        `Event ingest sequence sync returned HTTP ${response.status}: ${responseBody.text.slice(0, 300)}`,
      );
    }

    const lastAcceptedSeq = responseBody.parsed?.last_accepted_seq;
    if (typeof lastAcceptedSeq === "number" && lastAcceptedSeq > 0) {
      const offset = lastAcceptedSeq;
      this.bufferedEvents = this.bufferedEvents.map((event) => ({
        ...event,
        seq: event.seq + offset,
      }));
      this.sequence += offset;
    }

    this.sequenceSynced = true;
  }

  private buildHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.token}`,
      "Content-Type": "application/x-ndjson",
    };
  }

  private buildBatchBody(): string {
    const lines: string[] = [];
    let batchBytes = 0;

    for (const envelope of this.bufferedEvents) {
      if (lines.length >= this.maxBatchEvents) {
        break;
      }

      const line = `${this.serializeEnvelope(envelope)}\n`;
      const lineBytes = Buffer.byteLength(line, "utf8");
      if (lines.length > 0 && batchBytes + lineBytes > this.maxBatchBytes) {
        break;
      }

      lines.push(line);
      batchBytes += lineBytes;
    }

    return lines.join("");
  }

  private rebaseBufferedEvents(lastAcceptedSeq: number): void {
    let nextSeq = lastAcceptedSeq + 1;
    this.bufferedEvents = this.bufferedEvents.map((event) => ({
      ...event,
      seq: nextSeq++,
    }));
    this.sequence = nextSeq - 1;
    this.sequenceSynced = true;
    this.bufferRevision += 1;
  }

  private async parseResponse(
    response: Response,
  ): Promise<{ parsed: IngestResponse | null; text: string }> {
    const text = await response.text();
    if (!text) {
      return { parsed: null, text };
    }

    try {
      return { parsed: JSON.parse(text) as IngestResponse, text };
    } catch {
      return { parsed: null, text };
    }
  }

  private canAcceptEvent(event: Record<string, unknown>): boolean {
    const eventBytes = Buffer.byteLength(
      this.serializeEnvelope({ seq: this.sequence + 1, event }),
      "utf8",
    );
    if (eventBytes > this.maxEventBytes) {
      this.config.logger.warn("Dropped oversized task run event", {
        eventBytes,
        maxEventBytes: this.maxEventBytes,
      });
      return false;
    }

    if (this.bufferedEvents.length >= this.maxBufferedEvents) {
      this.droppedBeforeSequenceCount += 1;
      if (
        this.droppedBeforeSequenceCount === 1 ||
        this.droppedBeforeSequenceCount % 100 === 0
      ) {
        this.config.logger.warn(
          "Dropped task run event before assigning sequence due to backpressure",
          {
            dropped: this.droppedBeforeSequenceCount,
            maxBufferedEvents: this.maxBufferedEvents,
          },
        );
      }
      return false;
    }

    if (this.droppedBeforeSequenceCount > 0) {
      this.config.logger.warn("Task run event ingest recovered after drops", {
        dropped: this.droppedBeforeSequenceCount,
      });
      this.droppedBeforeSequenceCount = 0;
    }

    return true;
  }

  private serializeEnvelope(envelope: EventEnvelope): string {
    return JSON.stringify({ seq: envelope.seq, event: envelope.event });
  }

  private describeError(error: unknown): unknown {
    if (error instanceof Error) {
      return { message: error.message, stack: error.stack };
    }
    return error;
  }
}
