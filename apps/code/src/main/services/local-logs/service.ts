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

  async truncateLocalLogs(taskRunId: string, lineCount: number): Promise<void> {
    const logPath = this.getLocalLogPath(taskRunId);
    let content: string;
    try {
      content = await fs.promises.readFile(logPath, "utf-8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        log.warn("Failed to read local logs for truncation:", error);
      }
      return;
    }
    const lines = content.split("\n").filter((l) => l.trim());
    if (lines.length <= lineCount) return;
    const truncated = `${lines.slice(0, lineCount).join("\n")}\n`;
    const tmpPath = `${logPath}.tmp.${Date.now()}`;
    try {
      await fs.promises.writeFile(tmpPath, truncated, "utf-8");
      await fs.promises.rename(tmpPath, logPath);
    } catch (error) {
      log.warn("Failed to write truncated local logs:", error);
      await fs.promises.unlink(tmpPath).catch(() => {});
    }
  }

  /**
   * After truncateLocalLogs, any in-flight drain may overwrite the truncated
   * file with stale accumulated content. Clearing pending prevents an extra
   * write after the current doWrite completes. The renderer's first writeLocalLogs
   * after reconnect will restore the correct truncated content anyway.
   */
  cancelPendingWrite(taskRunId: string): void {
    const entry = this.writes.get(taskRunId);
    if (entry) {
      entry.state.pending = undefined;
    }
  }

  /**
   * Trims local logs.ndjson to the JSON-RPC response for the given prompt id
   * (the turn-completion boundary). Returns false when the trim could not be
   * guaranteed — a real read/write error, or the boundary line was not found
   * while there was content to search — so the caller can warn the user that
   * the restored view may still contain post-checkpoint turns. A missing log
   * file (nothing to trim) returns true.
   */
  async truncateLocalLogsAtPromptBoundary(
    taskRunId: string,
    promptId: number,
    preserveTrailingEntries: string[] = [],
  ): Promise<boolean> {
    const logPath = this.getLocalLogPath(taskRunId);
    let content: string;
    try {
      content = await fs.promises.readFile(logPath, "utf-8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        log.warn(
          "Failed to read local logs for prompt-boundary truncation:",
          error,
        );
        return false;
      }
      // No log file yet — nothing to truncate.
      return true;
    }

    const lines = content.split("\n").filter((l) => l.trim());
    let boundaryIdx = -1;

    for (let i = 0; i < lines.length; i++) {
      try {
        const parsed = JSON.parse(lines[i]) as {
          type?: string;
          notification?: { id?: number; result?: unknown };
        };
        const notif = parsed.notification;
        if (
          parsed.type === "notification" &&
          notif != null &&
          typeof notif.id === "number" &&
          notif.id === promptId &&
          "result" in notif
        ) {
          boundaryIdx = i;
        }
      } catch {
        // skip unparseable lines
      }
    }

    if (boundaryIdx === -1) {
      log.warn("truncateLocalLogsAtPromptBoundary: prompt boundary not found", {
        taskRunId,
        promptId,
      });
      return false;
    }

    const keptLines = lines.slice(0, boundaryIdx + 1);
    // Re-add entries that belong to the kept turns but were appended after the
    // boundary — e.g. the restored turn's git_checkpoint notification, captured
    // on TURN_COMPLETE after the prompt response, which the trim would otherwise
    // drop (leaving the restored turn with a disabled restore icon). Skip dups.
    const preserved = preserveTrailingEntries
      .map((e) => e.trim())
      .filter((e) => e.length > 0 && !keptLines.includes(e));

    // Nothing after the boundary and nothing to re-add → already trimmed.
    if (boundaryIdx + 1 >= lines.length && preserved.length === 0) {
      return true;
    }

    const truncated = `${[...keptLines, ...preserved].join("\n")}\n`;
    const tmpPath = `${logPath}.tmp.${Date.now()}`;
    try {
      await fs.promises.writeFile(tmpPath, truncated, "utf-8");
      await fs.promises.rename(tmpPath, logPath);
    } catch (error) {
      log.warn("Failed to write prompt-boundary truncated local logs:", error);
      await fs.promises.unlink(tmpPath).catch(() => {});
      return false;
    }

    log.info(
      "truncateLocalLogsAtPromptBoundary: truncated to prompt boundary",
      {
        taskRunId,
        promptId,
        keptLines: keptLines.length,
        preserved: preserved.length,
        originalLines: lines.length,
      },
    );

    // Queue the truncated content as the next write so any in-flight drain
    // that overwrites the file with pre-truncate content is followed by a
    // corrective write of the properly-trimmed content.
    this.writeLocalLogs(taskRunId, truncated);
    return true;
  }

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
