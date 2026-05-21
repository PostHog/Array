import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { injectable } from "inversify";
import { DATA_DIR } from "../../../shared/constants";
import { logger } from "../../utils/logger";

const log = logger.scope("local-logs");

interface WriteState {
  pending: string | undefined;
  lastWritten: string | undefined;
  dirReady: boolean;
}

/**
 * Single-flight per `taskRunId` with latest-wins coalescing. Prevents the
 * gap-reconcile loop from spawning parallel writeFile of the same NDJSON.
 */
@injectable()
export class LocalLogsService {
  private writes = new Map<
    string,
    { state: WriteState; inFlight: Promise<void> }
  >();

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
      existing.state.pending = content;
      return existing.inFlight;
    }

    const state: WriteState = {
      pending: undefined,
      lastWritten: undefined,
      dirReady: false,
    };
    const inFlight = this.drain(taskRunId, content, state);
    this.writes.set(taskRunId, { state, inFlight });
    return inFlight;
  }

  private async drain(
    taskRunId: string,
    initialContent: string,
    state: WriteState,
  ): Promise<void> {
    try {
      let next: string | undefined = initialContent;
      while (next !== undefined) {
        const current = next;
        next = undefined;
        if (current !== state.lastWritten) {
          await this.doWrite(taskRunId, current, state);
          state.lastWritten = current;
        }
        if (state.pending !== undefined) {
          next = state.pending;
          state.pending = undefined;
        }
      }
    } finally {
      this.writes.delete(taskRunId);
    }
  }

  private async doWrite(
    taskRunId: string,
    content: string,
    state: WriteState,
  ): Promise<void> {
    const logPath = this.getLocalLogPath(taskRunId);
    try {
      if (!state.dirReady) {
        await fs.promises.mkdir(path.dirname(logPath), { recursive: true });
        state.dirReady = true;
      }
      await fs.promises.writeFile(logPath, content, "utf-8");
    } catch (error) {
      log.warn("Failed to write local logs:", error);
    }
  }

  private getLocalLogPath(taskRunId: string): string {
    return path.join(
      os.homedir(),
      DATA_DIR,
      "sessions",
      taskRunId,
      "logs.ndjson",
    );
  }
}
