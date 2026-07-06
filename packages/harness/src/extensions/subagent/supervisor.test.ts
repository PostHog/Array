import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRunId } from "./lifecycle";
import {
  listPendingSupervisorRequests,
  pollSupervisorRequests,
  replyToSupervisorRequest,
  waitForSupervisorReply,
  writeSupervisorBridgeExtension,
  writeSupervisorRequest,
} from "./supervisor";

describe("supervisor mailbox", () => {
  let originalHome: string | undefined;
  let tmpHome: string;

  beforeEach(() => {
    originalHome = process.env.HOME;
    tmpHome = fs.mkdtempSync(
      path.join(os.tmpdir(), "posthog-subagent-supervisor-"),
    );
    process.env.HOME = tmpHome;
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("writeSupervisorRequest then replyToSupervisorRequest round-trips through waitForSupervisorReply", async () => {
    const runId = createRunId();
    const request = writeSupervisorRequest(
      runId,
      "need_decision",
      "Should I proceed?",
    );

    const waitPromise = waitForSupervisorReply(runId, request.requestId, {
      pollIntervalMs: 10,
      timeoutMs: 2000,
    });
    await new Promise((r) => setTimeout(r, 20));
    replyToSupervisorRequest(runId, request.requestId, "Yes, proceed.");

    await expect(waitPromise).resolves.toBe("Yes, proceed.");
  });

  it("waitForSupervisorReply resolves undefined on timeout", async () => {
    const runId = createRunId();
    const request = writeSupervisorRequest(runId, "blocked", "stuck");
    await expect(
      waitForSupervisorReply(runId, request.requestId, {
        pollIntervalMs: 5,
        timeoutMs: 20,
      }),
    ).resolves.toBeUndefined();
  });

  it("waitForSupervisorReply resolves undefined when the signal aborts", async () => {
    const runId = createRunId();
    const request = writeSupervisorRequest(runId, "blocked", "stuck");
    const controller = new AbortController();
    const waitPromise = waitForSupervisorReply(runId, request.requestId, {
      pollIntervalMs: 5,
      signal: controller.signal,
    });
    controller.abort();
    await expect(waitPromise).resolves.toBeUndefined();
  });

  it("listPendingSupervisorRequests excludes already-replied requests", () => {
    const runId = createRunId();
    const a = writeSupervisorRequest(runId, "clarify", "a?");
    const b = writeSupervisorRequest(runId, "clarify", "b?");
    replyToSupervisorRequest(runId, a.requestId, "answered");

    const pending = listPendingSupervisorRequests(runId);
    expect(pending.map((r) => r.requestId)).toEqual([b.requestId]);
  });

  it("listPendingSupervisorRequests returns an empty array when there's no mailbox yet", () => {
    expect(listPendingSupervisorRequests(createRunId())).toEqual([]);
  });

  it("pollSupervisorRequests calls onRequest once per new request and writes its reply", async () => {
    const runId = createRunId();
    const onRequest = vi.fn(async () => "auto-reply");
    const poller = pollSupervisorRequests(runId, onRequest, 5);

    try {
      const request = writeSupervisorRequest(
        runId,
        "need_decision",
        "continue?",
      );
      const reply = await waitForSupervisorReply(runId, request.requestId, {
        pollIntervalMs: 5,
        timeoutMs: 2000,
      });
      expect(reply).toBe("auto-reply");
      expect(onRequest).toHaveBeenCalledTimes(1);
    } finally {
      poller.stop();
    }
  });

  it("keeps polling (does not die or throw unhandled) after onRequest rejects, and still answers a later request", async () => {
    const runId = createRunId();
    let callCount = 0;
    const onRequest = vi.fn(async () => {
      callCount++;
      if (callCount === 1) throw new Error("ui.input blew up");
      return "second reply";
    });
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) =>
      unhandledRejections.push(reason);
    process.on("unhandledRejection", onUnhandledRejection);

    const poller = pollSupervisorRequests(runId, onRequest, 5);
    try {
      const first = writeSupervisorRequest(runId, "need_decision", "first?");
      const firstReply = await waitForSupervisorReply(runId, first.requestId, {
        pollIntervalMs: 5,
        timeoutMs: 200,
      });
      expect(firstReply).toBeUndefined(); // onRequest threw; left unanswered rather than crashing

      const second = writeSupervisorRequest(runId, "need_decision", "second?");
      const secondReply = await waitForSupervisorReply(
        runId,
        second.requestId,
        { pollIntervalMs: 5, timeoutMs: 2000 },
      );
      expect(secondReply).toBe("second reply"); // poller kept running after the first failure

      expect(unhandledRejections).toEqual([]);
    } finally {
      process.removeListener("unhandledRejection", onUnhandledRejection);
      poller.stop();
    }
  });

  it("writeSupervisorBridgeExtension generates a tool that round-trips a request/reply", async () => {
    const runId = createRunId();
    const { dir, filePath } = await writeSupervisorBridgeExtension(runId, 2000);

    try {
      const mod = (await import(filePath)) as {
        default: (pi: {
          registerTool: (tool: {
            execute: (...args: unknown[]) => Promise<unknown>;
          }) => void;
        }) => void;
      };
      let registeredTool:
        | { execute: (...args: unknown[]) => Promise<unknown> }
        | undefined;
      mod.default({
        registerTool: (tool) => {
          registeredTool = tool;
        },
      });
      if (!registeredTool)
        throw new Error("contact_supervisor was not registered");

      const executePromise = registeredTool.execute(
        "call-id",
        { reason: "clarify", message: "which approach?" },
        undefined,
      );

      await new Promise((r) => setTimeout(r, 50));
      const pending = listPendingSupervisorRequests(runId);
      expect(pending).toHaveLength(1);
      expect(pending[0].message).toBe("which approach?");
      replyToSupervisorRequest(runId, pending[0].requestId, "use approach B");

      const result = (await executePromise) as {
        content: Array<{ text: string }>;
      };
      expect(result.content[0].text).toBe("use approach B");
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true });
    }
  }, 10_000);
});
