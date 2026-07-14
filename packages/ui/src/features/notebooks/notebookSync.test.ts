import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { markdownCrc } from "./markdown-notebook/collaboration";
import {
  type NotebookSyncDeps,
  NotebookSyncEngine,
  type NotebookSyncSaveResult,
  type NotebookSyncStatus,
} from "./notebookSync";

type SaveInput = Parameters<NotebookSyncDeps["saveMarkdown"]>[0];

function makeHarness(initialMarkdown = "hello") {
  const saves: SaveInput[] = [];
  const statuses: NotebookSyncStatus[] = [];
  const remotes: { markdown: string; version: number }[] = [];
  let saveResults: NotebookSyncSaveResult[] = [];
  let reloadResult = { markdown: initialMarkdown, version: 1, nodeId: "n1" };
  let reloads = 0;

  const defaultSave: NotebookSyncDeps["saveMarkdown"] = (input) => {
    saves.push(input);
    const result = saveResults.shift();
    if (!result) {
      return Promise.resolve({
        status: "saved" as const,
        markdown: input.markdown,
        version: input.version + 1,
      });
    }
    return Promise.resolve(result);
  };
  let saveImpl = defaultSave;

  const deps: NotebookSyncDeps = {
    saveMarkdown: (input) => saveImpl(input),
    reload: () => {
      reloads += 1;
      return Promise.resolve(reloadResult);
    },
    onRemoteContent: (remote) => remotes.push(remote),
    onStatusChange: (status) => statuses.push(status),
  };

  const engine = new NotebookSyncEngine(
    { markdown: initialMarkdown, version: 1, nodeId: "n1" },
    deps,
    "client-1",
  );

  return {
    engine,
    saves,
    statuses,
    remotes,
    queueSaveResult: (...results: NotebookSyncSaveResult[]) => {
      saveResults = [...saveResults, ...results];
    },
    setReloadResult: (r: typeof reloadResult) => {
      reloadResult = r;
    },
    getReloads: () => reloads,
    setSaveImpl: (impl: NotebookSyncDeps["saveMarkdown"]) => {
      saveImpl = impl;
    },
    defaultSave,
  };
}

async function drainTimers(): Promise<void> {
  // Runs pending timers and lets the promise chains they trigger settle.
  for (let i = 0; i < 10; i += 1) {
    await vi.runAllTimersAsync();
  }
}

describe("NotebookSyncEngine", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces edits and saves against the baseline version", async () => {
    const h = makeHarness("hello");
    h.engine.handleChange("hello w");
    h.engine.handleChange("hello world");
    await drainTimers();

    expect(h.saves).toHaveLength(1);
    expect(h.saves[0]).toMatchObject({
      clientId: "client-1",
      version: 1,
      markdown: "hello world",
      nodeId: "n1",
    });
    expect(h.statuses.at(-1)).toBe("saved");
  });

  it("does not save when the document returns to the saved state", async () => {
    const h = makeHarness("hello");
    h.engine.handleChange("hellox");
    h.engine.handleChange("hello");
    await drainTimers();

    expect(h.saves).toHaveLength(0);
    expect(h.statuses.at(-1)).toBe("saved");
  });

  it("advances the baseline version after a save and uses it next time", async () => {
    const h = makeHarness("hello");
    h.engine.handleChange("one");
    await drainTimers();
    h.engine.handleChange("two");
    await drainTimers();

    expect(h.saves).toHaveLength(2);
    expect(h.saves[1].version).toBe(2);
  });

  it("saves again immediately when typing landed during the request", async () => {
    const h = makeHarness("hello");
    const pending: { resolve?: (r: NotebookSyncSaveResult) => void } = {};
    h.setSaveImpl((input) => {
      if (h.saves.length === 0) {
        h.saves.push(input);
        return new Promise((resolve) => {
          pending.resolve = resolve;
        });
      }
      return h.defaultSave(input);
    });

    h.engine.handleChange("draft one");
    await vi.advanceTimersByTimeAsync(400);
    expect(h.saves).toHaveLength(1);

    h.engine.handleChange("draft two");
    pending.resolve?.({ status: "saved", markdown: "draft one", version: 2 });
    await drainTimers();

    expect(h.saves).toHaveLength(2);
    expect(h.saves[1]).toMatchObject({ markdown: "draft two", version: 2 });
    expect(h.statuses.at(-1)).toBe("saved");
  });

  it("replays conflict diffs, merges, publishes remote content, and retries", async () => {
    const h = makeHarness("shared base\n");
    // Local edit appends a line; the missed remote diff prepends one.
    const remoteMarkdown = "remote first\nshared base\n";
    h.queueSaveResult({
      status: "conflict",
      serverVersion: 5,
      updates: [
        {
          version: 5,
          base_crc: markdownCrc("shared base\n"),
          diff: [{ start: 0, end: 0, text: "remote first\n" }],
        },
      ],
    });

    h.engine.handleChange("shared base\nlocal last\n");
    await drainTimers();

    // The reconstructed server state was pushed to the editor as remote.
    expect(h.remotes).toContainEqual({ markdown: remoteMarkdown, version: 5 });
    // The merged document (remote line + local line) was re-saved at v5.
    const retry = h.saves.at(-1);
    expect(retry?.version).toBe(5);
    expect(retry?.markdown).toContain("remote first");
    expect(retry?.markdown).toContain("local last");
    expect(h.statuses.at(-1)).toBe("saved");
  });

  it("falls back to reload when the CRC does not match our baseline", async () => {
    const h = makeHarness("hello");
    h.queueSaveResult({
      status: "conflict",
      serverVersion: 9,
      updates: [
        {
          version: 9,
          base_crc: markdownCrc("something entirely different"),
          diff: [{ start: 0, end: 0, text: "x" }],
        },
      ],
    });
    h.setReloadResult({ markdown: "server truth", version: 9, nodeId: "n1" });

    h.engine.handleChange("hello local");
    await drainTimers();

    expect(h.getReloads()).toBe(1);
    expect(h.remotes).toContainEqual({ markdown: "server truth", version: 9 });
  });

  it("reloads on gone (410)", async () => {
    const h = makeHarness("hello");
    h.queueSaveResult({ status: "gone" });
    h.setReloadResult({ markdown: "fresh", version: 12, nodeId: "n1" });

    h.engine.handleChange("hello local");
    await drainTimers();

    expect(h.getReloads()).toBe(1);
    expect(h.remotes).toContainEqual({ markdown: "fresh", version: 12 });
  });

  it("keeps the edit and retries after a network failure", async () => {
    const h = makeHarness("hello");
    let failures = 0;
    h.setSaveImpl((input) => {
      if (failures === 0) {
        failures += 1;
        h.saves.push(input);
        return Promise.reject(new Error("offline"));
      }
      return h.defaultSave(input);
    });

    h.engine.handleChange("hello again");
    await vi.advanceTimersByTimeAsync(400);
    expect(h.statuses).toContain("error");

    await drainTimers();
    expect(h.saves.length).toBeGreaterThanOrEqual(2);
    expect(h.statuses.at(-1)).toBe("saved");
  });

  it("stops scheduling after dispose", async () => {
    const h = makeHarness("hello");
    h.engine.handleChange("changed");
    h.engine.dispose();
    await drainTimers();

    expect(h.saves).toHaveLength(0);
  });
});
