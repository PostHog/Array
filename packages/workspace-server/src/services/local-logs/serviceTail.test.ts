import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalLogsService } from "./service";

const RUN = "run-tail";

describe("LocalLogsService.readLocalLogsTail", () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "phlogs-"));
    vi.spyOn(os, "homedir").mockReturnValue(tmpHome);
    fs.mkdirSync(path.join(tmpHome, ".posthog-code", "sessions", RUN), {
      recursive: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  const logPath = () =>
    path.join(tmpHome, ".posthog-code", "sessions", RUN, "logs.ndjson");

  it("returns the whole file untruncated when it's under maxBytes", async () => {
    const content = "line1\nline2\nline3\n";
    fs.writeFileSync(logPath(), content);

    const res = await new LocalLogsService().readLocalLogsTail(RUN, 1_000_000);

    expect(res).toEqual({ content, truncated: false });
  });

  it("returns only the tail, dropping the partial first line, when over maxBytes", async () => {
    const lines = Array.from(
      { length: 1000 },
      (_, i) => `{"i":${i},"pad":"${"x".repeat(200)}"}`,
    );
    fs.writeFileSync(logPath(), `${lines.join("\n")}\n`);

    const res = await new LocalLogsService().readLocalLogsTail(RUN, 5000);

    expect(res?.truncated).toBe(true);
    const tailLines = res?.content.trim().split("\n") ?? [];
    // Every retained line is a whole, parseable ndjson entry (no fragment).
    for (const line of tailLines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
    // It's the suffix of the file — ends with the last written line.
    expect(tailLines.at(-1)).toBe(lines.at(-1));
    // It's a strict tail, not the whole file.
    expect(tailLines.length).toBeLessThan(lines.length);
  });

  it("keeps the whole first line when the window starts on a line boundary", async () => {
    fs.writeFileSync(logPath(), "aaaa\nbbbb\ncccc\n");

    const res = await new LocalLogsService().readLocalLogsTail(RUN, 10);

    expect(res).toEqual({ content: "bbbb\ncccc\n", truncated: true });
  });

  it("returns empty content when a single line exceeds maxBytes", async () => {
    fs.writeFileSync(logPath(), `{"pad":"${"x".repeat(500)}"}\n`);

    const res = await new LocalLogsService().readLocalLogsTail(RUN, 100);

    expect(res).toEqual({ content: "", truncated: true });
  });

  it("returns null when the log doesn't exist", async () => {
    expect(
      await new LocalLogsService().readLocalLogsTail("missing", 1000),
    ).toBeNull();
  });
});
