import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { injectable } from "inversify";
import { logger } from "../../utils/logger";

const log = logger.scope("local-logs");

interface WriteState {
  inFlight: Promise<void>;
  pending: string | undefined;
}

/**
 * Owns the per-run NDJSON cache at `~/.posthog-code/sessions/{taskRunId}/logs.ndjson`.
 *
 * `writeLocalLogs` is single-flight per `taskRunId` with latest-wins coalescing:
 * if a write is already in flight when a new one arrives, the new content replaces
 * any queued content rather than spawning a parallel `fs.promises.writeFile`. This
 * prevents a storm of full-file overwrites when the renderer's gap-reconcile loop
 * fires `writeLocalLogs` per SSE snapshot — that storm pegs the main thread on
 * `FileHandle::CloseReq::Resolve` continuations and is what tipped a user's app
 * into an 81-second hang on launch.
 */
@injectable()
export class LocalLogsService {
  private writes = new Map<string, WriteState>();

  async readLocalLogs(taskRunId: string): Promise<string | null> {
    const logPath = this.getLocalLogPath(taskRunId);
    try {
      return await fs.promises.readFile(logPath, "utf-8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      log.warn("Failed to read local logs:", error);
      return null;
    }
  }

  writeLocalLogs(taskRunId: string, content: string): Promise<void> {
    const existing = this.writes.get(taskRunId);
    if (existing) {
      existing.pending = content;
      return existing.inFlight;
    }

    const entry: WriteState = {
      inFlight: undefined as unknown as Promise<void>,
      pending: undefined,
    };

    entry.inFlight = this.drain(taskRunId, content, entry);
    this.writes.set(taskRunId, entry);
    return entry.inFlight;
  }

  private async drain(
    taskRunId: string,
    initialContent: string,
    entry: WriteState,
  ): Promise<void> {
    let next: string | undefined = initialContent;
    while (next !== undefined) {
      const current = next;
      next = undefined;
      await this.doWrite(taskRunId, current);
      if (entry.pending !== undefined) {
        next = entry.pending;
        entry.pending = undefined;
      }
    }
    this.writes.delete(taskRunId);
  }

  private async doWrite(taskRunId: string, content: string): Promise<void> {
    const logPath = this.getLocalLogPath(taskRunId);
    const logDir = path.dirname(logPath);
    try {
      await fs.promises.mkdir(logDir, { recursive: true });
      await fs.promises.writeFile(logPath, content, "utf-8");
    } catch (error) {
      log.warn("Failed to write local logs:", error);
    }
  }

  private getLocalLogPath(taskRunId: string): string {
    return path.join(
      os.homedir(),
      ".posthog-code",
      "sessions",
      taskRunId,
      "logs.ndjson",
    );
  }
}
