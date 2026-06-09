import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { findCodexRollout, truncateCodexRollout } from "./rollout";

// truncateCodexRollout is the memory-truncation half of checkpoint restore:
// after a restore it trims the on-disk codex-acp rollout to the first N turns
// so the resumed session only remembers up to the checkpoint. These tests use
// a real temp CODEX_HOME so the file-walk + atomic write are exercised end to
// end (the writeFileWithRetry success path included).

const META = JSON.stringify({ type: "session_meta", payload: { id: "s" } });

function turn(n: number): string[] {
  return [
    JSON.stringify({ type: "event_msg", payload: { type: "task_started" } }),
    JSON.stringify({ type: "response_item", payload: { text: `turn${n}` } }),
    JSON.stringify({ type: "event_msg", payload: { type: "task_complete" } }),
  ];
}

function rollout(turns: number): string {
  const lines = [META];
  for (let i = 1; i <= turns; i++) lines.push(...turn(i));
  return `${lines.join("\n")}\n`;
}

describe("truncateCodexRollout", () => {
  let codexHome: string;
  let prevCodexHome: string | undefined;
  const sessionId = "test-session-abc";

  async function writeRollout(content: string): Promise<string> {
    const dir = path.join(codexHome, "sessions", "2026", "06", "08");
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(
      dir,
      `rollout-2026-06-08T00-00-00-${sessionId}.jsonl`,
    );
    await fs.writeFile(file, content, "utf-8");
    return file;
  }

  async function readLines(file: string): Promise<string[]> {
    const content = await fs.readFile(file, "utf-8");
    return content.split("\n").filter((l) => l.trim());
  }

  beforeEach(async () => {
    prevCodexHome = process.env.CODEX_HOME;
    codexHome = await fs.mkdtemp(path.join(os.tmpdir(), "codex-rollout-"));
    process.env.CODEX_HOME = codexHome;
  });

  afterEach(async () => {
    if (prevCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = prevCodexHome;
    await fs.rm(codexHome, { recursive: true, force: true });
  });

  test("findCodexRollout locates the rollout file for a session", async () => {
    const file = await writeRollout(rollout(2));
    const found = await findCodexRollout(sessionId);
    expect(found).toBe(file);
  });

  test("keeps only the first turn when keepTurns=1 (restore to first turn)", async () => {
    const file = await writeRollout(rollout(3));
    const ok = await truncateCodexRollout(sessionId, 1);
    expect(ok).toBe(true);

    const lines = await readLines(file);
    // session_meta + 3 lines of turn 1
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe(META);
    expect(lines.some((l) => l.includes("turn1"))).toBe(true);
    expect(lines.some((l) => l.includes("turn2"))).toBe(false);
    expect(lines.some((l) => l.includes("turn3"))).toBe(false);
  });

  test("keeps the first two turns when keepTurns=2 (restore to a middle turn)", async () => {
    const file = await writeRollout(rollout(3));
    const ok = await truncateCodexRollout(sessionId, 2);
    expect(ok).toBe(true);

    const lines = await readLines(file);
    // session_meta + 2 turns * 3 lines
    expect(lines).toHaveLength(7);
    expect(lines.some((l) => l.includes("turn2"))).toBe(true);
    expect(lines.some((l) => l.includes("turn3"))).toBe(false);
  });

  test("returns false when the session rollout file is not found", async () => {
    const ok = await truncateCodexRollout("nonexistent-session", 1);
    expect(ok).toBe(false);
  });

  test("returns false and leaves the file intact when no complete turns exist", async () => {
    // Only a started turn with no task_complete.
    const content = `${[
      META,
      JSON.stringify({ type: "event_msg", payload: { type: "task_started" } }),
      JSON.stringify({ type: "response_item", payload: { text: "partial" } }),
    ].join("\n")}\n`;
    const file = await writeRollout(content);

    const ok = await truncateCodexRollout(sessionId, 1);
    expect(ok).toBe(false);

    // File untouched.
    const lines = await readLines(file);
    expect(lines).toHaveLength(3);
  });
});
