import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { injectable } from "inversify";

import type { ILogsService } from "./identifiers";

const DATA_DIR = ".posthog-code";

const TOOL_CALL_UPDATE_MARKER = '"sessionUpdate":"tool_call_update"';
const TOOL_CALL_ID_RE = /"toolCallId":"([^"]+)"/;

/**
 * Drop superseded `tool_call_update` lines (keep the last per `toolCallId`)
 * before the log crosses to the renderer. Agents re-send the full accumulated
 * tool output on every update, so the transfer + parse would otherwise carry
 * hundreds of MB of redundant snapshots. Whole lines are dropped so the result
 * stays valid NDJSON; line-based (no JSON.parse) to stay cheap on a 300MB log.
 */
function collapseToolCallUpdateLines(ndjson: string): string {
  const lines = ndjson.split("\n");
  const lastIndexById = new Map<string, number>();
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes(TOOL_CALL_UPDATE_MARKER)) continue;
    const id = lines[i].match(TOOL_CALL_ID_RE)?.[1];
    if (id) lastIndexById.set(id, i);
  }
  if (lastIndexById.size === 0) return ndjson;

  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(TOOL_CALL_UPDATE_MARKER)) {
      const id = lines[i].match(TOOL_CALL_ID_RE)?.[1];
      if (id && lastIndexById.get(id) !== i) continue;
    }
    kept.push(lines[i]);
  }
  return kept.join("\n");
}

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
export class LocalLogsService implements ILogsService {
  private writes = new Map<
    string,
    { state: WriteState; inFlight: Promise<void> }
  >();

  async fetchS3Logs(logUrl: string): Promise<string | null> {
    try {
      const response = await fetch(logUrl);
      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        return null;
      }
      return await response.text();
    } catch {
      return null;
    }
  }

  async readLocalLogs(taskRunId: string): Promise<string | null> {
    const logPath = this.getLocalLogPath(taskRunId);
    try {
      return await fs.promises.readFile(logPath, "utf-8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      return null;
    }
  }

  async readLocalLogsCollapsed(
    taskRunId: string,
  ): Promise<{ content: string; totalLineCount: number } | null> {
    const raw = await this.readLocalLogs(taskRunId);
    if (raw === null) return null;
    const trimmed = raw.trim();
    const totalLineCount = trimmed ? trimmed.split("\n").length : 0;
    return { content: collapseToolCallUpdateLines(raw), totalLineCount };
  }

  async readLocalLogsTail(
    taskRunId: string,
    maxBytes: number,
  ): Promise<{ content: string; truncated: boolean } | null> {
    const logPath = this.getLocalLogPath(taskRunId);
    try {
      const stat = await fs.promises.stat(logPath);
      if (stat.size <= maxBytes) {
        return {
          content: await fs.promises.readFile(logPath, "utf-8"),
          truncated: false,
        };
      }
      const handle = await fs.promises.open(logPath, "r");
      try {
        // Read one extra byte before the window: a newline there means the
        // window already starts on a whole line. Otherwise the first line is
        // a fragment (and may start with a broken multi-byte char) — drop
        // everything up to the first newline so only whole ndjson lines
        // remain.
        const start = stat.size - maxBytes - 1;
        const buf = Buffer.alloc(maxBytes + 1);
        const { bytesRead } = await handle.read(buf, 0, maxBytes + 1, start);
        const raw = buf.toString("utf-8", 1, bytesRead);
        if (buf[0] === 0x0a) {
          return { content: raw, truncated: true };
        }
        const nl = raw.indexOf("\n");
        return { content: nl >= 0 ? raw.slice(nl + 1) : "", truncated: true };
      } finally {
        await handle.close();
      }
    } catch {
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

  async seedLocalLogs(taskRunId: string, content: string): Promise<void> {
    if (!content?.trim()) return;
    const logPath = this.getLocalLogPath(taskRunId);
    const marker = JSON.stringify({ type: "seed_boundary" });
    const trailingNewline = content.endsWith("\n") ? "" : "\n";
    await fs.promises.mkdir(path.dirname(logPath), { recursive: true });
    await fs.promises.writeFile(
      logPath,
      `${content}${trailingNewline}${marker}\n`,
      "utf-8",
    );
  }

  async countLocalLogEntries(taskRunId: string): Promise<number> {
    const logPath = this.getLocalLogPath(taskRunId);
    try {
      const content = await fs.promises.readFile(logPath, "utf-8");
      return content.split("\n").filter((line) => line.trim()).length;
    } catch {
      return 0;
    }
  }

  async deleteLocalLogCache(taskRunId: string): Promise<void> {
    const logPath = this.getLocalLogPath(taskRunId);
    await fs.promises.rm(logPath, { force: true });
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
    } catch {}
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
