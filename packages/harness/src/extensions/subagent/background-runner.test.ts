import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BackgroundRunRegistry } from "./background-runner";
import { readStatus } from "./lifecycle";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("BackgroundRunRegistry", () => {
  let originalHome: string | undefined;
  let tmpHome: string;

  beforeEach(() => {
    originalHome = process.env.HOME;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "posthog-subagent-bg-"));
    process.env.HOME = tmpHome;
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("tracks a run as isRunning until it settles, then marks lifecycle 'completed'", async () => {
    const registry = new BackgroundRunRegistry();
    const gate = deferred<void>();

    const handle = registry.start(
      { mode: "single", agents: ["scout"] },
      async () => {
        await gate.promise;
        return { model: "anthropic/opus", totalTokens: 10, totalCost: 0.01 };
      },
    );

    expect(handle.isRunning()).toBe(true);
    expect(registry.get(handle.runId)).toBe(handle);

    gate.resolve();
    await handle.done;

    expect(handle.isRunning()).toBe(false);
    const status = readStatus(handle.runId);
    expect(status?.state).toBe("completed");
    expect(status?.model).toBe("anthropic/opus");
    expect(status?.totalTokens).toBe(10);
  });

  it("marks lifecycle 'failed' with the error message when fn rejects", async () => {
    const registry = new BackgroundRunRegistry();
    const handle = registry.start(
      { mode: "single", agents: ["scout"] },
      async () => {
        throw new Error("boom");
      },
    );

    await handle.done;
    const status = readStatus(handle.runId);
    expect(status?.state).toBe("failed");
    expect(status?.error).toBe("boom");
  });

  it("interrupt() aborts the run's signal and marks lifecycle 'aborted'", async () => {
    const registry = new BackgroundRunRegistry();
    const started = deferred<void>();

    const handle = registry.start(
      { mode: "single", agents: ["scout"] },
      async (signal) => {
        started.resolve();
        await new Promise<void>((resolve) => {
          if (signal.aborted) return resolve();
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
        return {};
      },
    );

    await started.promise;
    expect(registry.interrupt(handle.runId)).toBe(true);
    await handle.done;

    expect(readStatus(handle.runId)?.state).toBe("aborted");
  });

  it("interrupt() returns false for an unknown runId", () => {
    const registry = new BackgroundRunRegistry();
    expect(registry.interrupt("not-a-real-run")).toBe(false);
  });

  it("list() reflects all runs started on this registry", () => {
    const registry = new BackgroundRunRegistry();
    const a = registry.start(
      { mode: "single", agents: ["scout"] },
      async () => ({}),
    );
    const b = registry.start(
      { mode: "single", agents: ["worker"] },
      async () => ({}),
    );
    expect(
      registry
        .list()
        .map((r) => r.runId)
        .sort(),
    ).toEqual([a.runId, b.runId].sort());
  });
});
