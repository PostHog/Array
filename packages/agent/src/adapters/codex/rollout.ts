import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

interface RolloutLog {
  info: (msg: string, data?: unknown) => void;
  warn: (msg: string, data?: unknown) => void;
}

function getCodexHome(): string {
  return process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex");
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * On Windows the just-killed codex-acp subprocess can keep the rollout file
 * handle open for a short window after cancelSession, so an immediate
 * write/rename fails with EPERM/EACCES/EBUSY. Retry across a ~1.5s window so
 * the handle has time to release. Non-lock errors fail fast.
 */
async function writeFileWithRetry(
  targetPath: string,
  content: string,
  log?: RolloutLog,
): Promise<boolean> {
  const delaysMs = [0, 50, 100, 200, 400, 800];
  let lastError: unknown;
  for (let attempt = 0; attempt < delaysMs.length; attempt++) {
    if (delaysMs[attempt] > 0) await sleep(delaysMs[attempt]);
    const tmpPath = `${targetPath}.tmp.${Date.now()}.${attempt}`;
    try {
      await fs.writeFile(tmpPath, content, "utf-8");
      await fs.rename(tmpPath, targetPath);
      return true;
    } catch (err) {
      lastError = err;
      await fs.unlink(tmpPath).catch(() => {});
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EPERM" && code !== "EACCES" && code !== "EBUSY") break;
      log?.info("Rollout write blocked by file lock, retrying", {
        code,
        attempt,
        nextDelayMs: delaysMs[attempt + 1],
      });
    }
  }
  log?.warn("Failed to write truncated codex rollout", {
    error: lastError instanceof Error ? lastError.message : String(lastError),
  });
  return false;
}

/**
 * Find the codex-acp rollout file for a given session ID.
 * Rollout files live at: <CODEX_HOME>/sessions/<year>/<month>/<day>/rollout-*-<sessionId>.jsonl
 */
export async function findCodexRollout(
  sessionId: string,
): Promise<string | undefined> {
  const sessionsDir = path.join(getCodexHome(), "sessions");
  try {
    const entries = await fs.readdir(sessionsDir, {
      recursive: true,
      withFileTypes: true,
    });
    for (const entry of entries) {
      if (
        entry.isFile() &&
        entry.name.startsWith("rollout-") &&
        entry.name.endsWith(`-${sessionId}.jsonl`)
      ) {
        return path.join(entry.parentPath, entry.name);
      }
    }
  } catch {
    // Sessions dir may not exist yet
  }
  return undefined;
}

/**
 * Truncate the codex-acp rollout file for a session to the first `keepTurns`
 * complete turns. A turn is bounded by event_msg:task_started → event_msg:task_complete.
 * The session_meta line (line 1) is always preserved.
 *
 * Must be called AFTER the codex-acp subprocess is killed so the file is not
 * being written to concurrently.
 *
 * Returns true if the file was successfully truncated, false otherwise (including
 * when the file is not found — fail-safe so git restore still works for display).
 */
export async function truncateCodexRollout(
  sessionId: string,
  keepTurns: number,
  log?: RolloutLog,
): Promise<boolean> {
  log?.info("Truncating codex rollout for checkpoint restore", {
    sessionId,
    keepTurns,
  });

  const rolloutPath = await findCodexRollout(sessionId);
  if (!rolloutPath) {
    log?.warn("Could not find codex rollout file for truncation", {
      sessionId,
    });
    return false;
  }

  log?.info("Found codex rollout file", { sessionId, rolloutPath });

  let content: string;
  try {
    content = await fs.readFile(rolloutPath, "utf-8");
  } catch (err) {
    log?.warn("Failed to read codex rollout file", {
      sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }

  const lines = content.split("\n").filter((l) => l.trim());
  log?.info("Codex rollout file read", {
    sessionId,
    totalLines: lines.length,
    keepTurns,
  });
  if (lines.length === 0) return false;

  const keepLines: string[] = [];

  // Always keep session_meta (first line)
  keepLines.push(lines[0]);

  // Walk remaining lines grouping into turn blocks bounded by
  // event_msg:task_started → event_msg:task_complete.
  // Keep the first keepTurns complete blocks; drop everything after.
  let turnsKept = 0;
  let inTurn = false;
  let currentTurnLines: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    let parsed: { type?: string; payload?: { type?: string } } | undefined;
    try {
      parsed = JSON.parse(line) as {
        type?: string;
        payload?: { type?: string };
      };
    } catch {
      if (inTurn) currentTurnLines.push(line);
      continue;
    }

    if (
      parsed.type === "event_msg" &&
      parsed.payload?.type === "task_started"
    ) {
      if (turnsKept >= keepTurns) break; // Discard this and all following turns
      inTurn = true;
      currentTurnLines = [line];
    } else if (
      parsed.type === "event_msg" &&
      parsed.payload?.type === "task_complete"
    ) {
      if (inTurn) {
        currentTurnLines.push(line);
        keepLines.push(...currentTurnLines);
        turnsKept++;
        inTurn = false;
        currentTurnLines = [];
      }
    } else if (inTurn) {
      currentTurnLines.push(line);
    }
  }

  if (turnsKept === 0 && keepTurns > 0) {
    log?.warn(
      "No complete turns found in codex rollout — leaving file intact",
      { sessionId, keepTurns, totalLines: lines.length },
    );
    return false;
  }

  const truncated = `${keepLines.join("\n")}\n`;
  const wrote = await writeFileWithRetry(rolloutPath, truncated, log);
  if (wrote) {
    log?.info("Truncated codex rollout to checkpoint boundary", {
      sessionId,
      keepTurns,
      turnsKept,
      keptLines: keepLines.length,
      originalLines: lines.length,
    });
  }
  return wrote;
}
