import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mapNotificationToLogRecord, OtelRunTelemetry } from "./otel-telemetry";
import type { StoredNotification } from "./types";

const mockLogExport = vi.fn((_logs, callback) => {
  callback({ code: 0 }); // Success
});

const mockSpanExport = vi.fn((_spans, callback) => {
  callback({ code: 0 }); // Success
});

vi.mock("@opentelemetry/exporter-logs-otlp-http", () => ({
  OTLPLogExporter: class {
    export = mockLogExport;
    shutdown = vi.fn().mockResolvedValue(undefined);
  },
}));

vi.mock("@opentelemetry/exporter-trace-otlp-http", () => ({
  OTLPTraceExporter: class {
    export = mockSpanExport;
    shutdown = vi.fn().mockResolvedValue(undefined);
  },
}));

const RUN_ID = "run-456";

const RESOURCE = {
  taskId: "task-123",
  runId: RUN_ID,
  deviceType: "cloud" as const,
  teamId: 42,
  userId: 7,
  distinctId: "distinct-1",
  adapter: "claude",
  mode: "background",
  agentVersion: "1.2.3",
};

function makeEntry(
  method: string,
  params?: Record<string, unknown>,
): StoredNotification {
  return {
    type: "notification",
    timestamp: "2026-07-06T12:00:00.000Z",
    notification: { jsonrpc: "2.0", method, params },
  };
}

function sessionUpdate(update: Record<string, unknown>): StoredNotification {
  return makeEntry("session/update", { update });
}

interface ExportedLog {
  body: string;
  attributes: Record<string, unknown>;
  resource: { attributes: Record<string, unknown> };
  spanContext?: { traceId: string; spanId: string };
}

interface ExportedSpan {
  name: string;
  kind: number;
  status: { code: number; message?: string };
  attributes: Record<string, unknown>;
  parentSpanContext?: { spanId: string };
  spanContext: () => { traceId: string; spanId: string };
}

function exportedLogs(): ExportedLog[] {
  return mockLogExport.mock.calls.flatMap((call) => call[0]);
}

function exportedSpans(): ExportedSpan[] {
  return mockSpanExport.mock.calls.flatMap((call) => call[0]);
}

function spanByName(name: string): ExportedSpan {
  const span = exportedSpans().find((s) => s.name === name);
  expect(span, `span ${name} should be exported`).toBeDefined();
  return span as ExportedSpan;
}

describe("OtelRunTelemetry", () => {
  beforeEach(() => {
    mockLogExport.mockClear();
    mockSpanExport.mockClear();
  });

  describe("mapNotificationToLogRecord", () => {
    it.each([
      {
        name: "run_started",
        entry: makeEntry("_posthog/run_started", {
          agentVersion: "1.0.0",
          sessionId: "acp-1",
        }),
        body: "run started",
        attrs: {
          event_type: "_posthog/run_started",
          agent_version: "1.0.0",
          session_id: "acp-1",
        },
      },
      {
        name: "double-prefixed extension method",
        entry: makeEntry("__posthog/run_started", {}),
        body: "run started",
        attrs: { event_type: "_posthog/run_started" },
      },
      {
        name: "sdk_session",
        entry: makeEntry("_posthog/sdk_session", {
          adapter: "claude",
          sessionId: "acp-1",
        }),
        body: "sdk session created (claude)",
        attrs: { adapter: "claude", session_id: "acp-1" },
      },
      {
        name: "usage_update with numeric cost",
        entry: makeEntry("_posthog/usage_update", {
          used: {
            inputTokens: 100,
            outputTokens: 20,
            cachedReadTokens: 5,
            cachedWriteTokens: 2,
          },
          cost: 0.42,
        }),
        body: "usage update",
        attrs: {
          tokens_input: 100,
          tokens_output: 20,
          tokens_cached_read: 5,
          tokens_cached_write: 2,
          cost_usd: 0.42,
        },
      },
      {
        name: "usage_update with cost object",
        entry: makeEntry("_posthog/usage_update", {
          cost: { amount: 1.5, currency: "USD" },
        }),
        body: "usage update",
        attrs: { cost_usd: 1.5 },
      },
      {
        name: "turn_complete",
        entry: makeEntry("_posthog/turn_complete", { stopReason: "end_turn" }),
        body: "turn complete (end_turn)",
        attrs: { stop_reason: "end_turn" },
      },
      {
        name: "task_complete",
        entry: makeEntry("_posthog/task_complete", {}),
        body: "task complete",
        attrs: { event_type: "_posthog/task_complete" },
      },
      {
        name: "error",
        entry: makeEntry("_posthog/error", {
          source: "agent_server",
          error: "boom",
        }),
        severityText: "ERROR",
        body: "error: boom",
        attrs: { error_source: "agent_server" },
      },
      {
        name: "console warn",
        entry: makeEntry("_posthog/console", {
          level: "warn",
          message: "careful",
        }),
        severityText: "WARN",
        body: "careful",
      },
      {
        name: "console with unknown level",
        entry: makeEntry("_posthog/console", { level: "silly", message: "m" }),
        severityText: "INFO",
        body: "m",
      },
      {
        name: "progress",
        entry: makeEntry("_posthog/progress", {
          group: "setup:run-1",
          step: "agent",
          status: "completed",
          label: "Started agent",
        }),
        body: "progress: agent completed (Started agent)",
        attrs: {
          progress_group: "setup:run-1",
          progress_step: "agent",
          progress_status: "completed",
        },
      },
      {
        name: "git_checkpoint",
        entry: makeEntry("_posthog/git_checkpoint", {
          branch: "posthog-code/fix",
        }),
        body: "git checkpoint",
        attrs: { branch: "posthog-code/fix" },
      },
      {
        name: "branch_created",
        entry: makeEntry("_posthog/branch_created", { branch: "b1" }),
        body: "branch created",
        attrs: { branch: "b1" },
      },
      {
        name: "permission_request without tool content",
        entry: makeEntry("_posthog/permission_request", {
          requestId: "r1",
          toolCallId: "t1",
          toolCall: { title: "rm -rf /" },
        }),
        body: "permission request",
        attrs: { request_id: "r1", tool_call_id: "t1" },
      },
      {
        name: "tool_call start",
        entry: sessionUpdate({
          sessionUpdate: "tool_call",
          toolCallId: "t1",
          kind: "execute",
          status: "pending",
          title: "Run tests",
        }),
        body: "tool call started (execute)",
        attrs: {
          session_update_type: "tool_call",
          tool_call_id: "t1",
          tool_kind: "execute",
          tool_status: "pending",
        },
      },
      {
        name: "terminal tool_call_update completed",
        entry: sessionUpdate({
          sessionUpdate: "tool_call_update",
          toolCallId: "t1",
          status: "completed",
        }),
        body: "tool call completed",
        attrs: { tool_call_id: "t1", tool_status: "completed" },
      },
      {
        name: "terminal tool_call_update failed",
        entry: sessionUpdate({
          sessionUpdate: "tool_call_update",
          toolCallId: "t1",
          status: "failed",
        }),
        severityText: "WARN",
        body: "tool call failed",
      },
    ])("maps $name", ({ entry, severityText = "INFO", body, attrs = {} }) => {
      const mapped = mapNotificationToLogRecord(entry);

      expect(mapped).not.toBeNull();
      expect(mapped?.severityText).toBe(severityText);
      expect(mapped?.body).toBe(body);
      expect(mapped?.attributes).toMatchObject(attrs);
    });

    // Content-bearing notifications must stay in the session log: exporting
    // them would ship customer prompts and repo content to the telemetry
    // project, and in-progress tool snapshots would multiply billed bytes.
    it.each([
      [
        "agent_message",
        sessionUpdate({
          sessionUpdate: "agent_message",
          content: { type: "text", text: "SECRET" },
        }),
      ],
      [
        "agent_message_chunk",
        sessionUpdate({
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "SECRET" },
        }),
      ],
      [
        "agent_thought_chunk",
        sessionUpdate({
          sessionUpdate: "agent_thought_chunk",
          content: { type: "text", text: "SECRET" },
        }),
      ],
      [
        "in-progress tool_call_update",
        sessionUpdate({
          sessionUpdate: "tool_call_update",
          toolCallId: "t1",
          status: "in_progress",
          rawInput: { command: "SECRET" },
        }),
      ],
      [
        "available_commands_update",
        sessionUpdate({
          sessionUpdate: "available_commands_update",
          availableCommands: [],
        }),
      ],
      [
        "user prompt request",
        makeEntry("session/prompt", {
          prompt: [{ type: "text", text: "SECRET" }],
        }),
      ],
      [
        "user_message",
        makeEntry("_posthog/user_message", { message: "SECRET" }),
      ],
      ["unknown extension method", makeEntry("_posthog/some_new_event", {})],
    ])("drops %s", (_name, entry) => {
      expect(mapNotificationToLogRecord(entry)).toBeNull();
    });

    it("caps body length", () => {
      const mapped = mapNotificationToLogRecord(
        makeEntry("_posthog/console", {
          level: "info",
          message: "x".repeat(5000),
        }),
      );

      expect(mapped?.body.length).toBeLessThanOrEqual(2001);
    });
  });

  describe("logs export", () => {
    let telemetry: OtelRunTelemetry;

    beforeEach(() => {
      telemetry = new OtelRunTelemetry(
        {
          url: "https://us.i.posthog.com/i/v1/logs",
          token: "phc_test_key",
          flushIntervalMs: 100,
        },
        RESOURCE,
      );
    });

    afterEach(async () => {
      await telemetry.shutdown();
    });

    it("pins run identity as resource attributes so runs are filterable per user", async () => {
      telemetry.append(RUN_ID, makeEntry("_posthog/run_started", {}));

      await telemetry.flush();

      const record = exportedLogs()[0];
      expect(record.resource.attributes).toMatchObject({
        "service.name": "posthog-code-agent",
        "service.version": "1.2.3",
        run_id: RUN_ID,
        task_id: "task-123",
        team_id: "42",
        user_id: "7",
        distinct_id: "distinct-1",
        device_type: "cloud",
        adapter: "claude",
        run_mode: "background",
      });
      // Without a traces URL, no spans are built and logs carry no trace ids.
      expect(mockSpanExport).not.toHaveBeenCalled();
      expect(record.spanContext).toBeUndefined();
    });

    it("never exports tool arguments, titles, or output content", async () => {
      telemetry.append(
        RUN_ID,
        sessionUpdate({
          sessionUpdate: "tool_call",
          toolCallId: "t1",
          kind: "execute",
          status: "pending",
          title: "bash: cat .env",
          rawInput: { command: "cat .env" },
        }),
      );
      telemetry.append(
        RUN_ID,
        sessionUpdate({
          sessionUpdate: "tool_call_update",
          toolCallId: "t1",
          status: "completed",
          rawOutput: { stdout: "AWS_KEY=leaked" },
        }),
      );

      await telemetry.flush();

      const records = exportedLogs();
      expect(records).toHaveLength(2);
      const surface = JSON.stringify(
        records.map((record) => [record.body, record.attributes]),
      );
      expect(surface).not.toContain(".env");
      expect(surface).not.toContain("leaked");
    });

    it("ignores entries for other sessions", async () => {
      telemetry.append("other-run", makeEntry("_posthog/run_started", {}));

      await telemetry.flush();

      expect(mockLogExport).not.toHaveBeenCalled();
    });

    it("swallows malformed entries instead of throwing", () => {
      const junk = {
        type: "notification",
        timestamp: "not-a-date",
        notification: { jsonrpc: "2.0", method: 123 },
      } as unknown as StoredNotification;

      expect(() => telemetry.append(RUN_ID, junk)).not.toThrow();
    });
  });

  describe("trace export", () => {
    let telemetry: OtelRunTelemetry;

    beforeEach(() => {
      telemetry = new OtelRunTelemetry(
        {
          url: "https://us.i.posthog.com/i/v1/logs",
          token: "phc_test_key",
          tracesUrl: "https://us.i.posthog.com/i/v1/traces",
          flushIntervalMs: 100,
        },
        RESOURCE,
      );
    });

    function driveSuccessfulRun(): void {
      telemetry.append(RUN_ID, makeEntry("_posthog/run_started", {}));
      telemetry.append(
        RUN_ID,
        makeEntry("session/prompt", {
          prompt: [{ type: "text", text: "SECRET" }],
        }),
      );
      telemetry.append(
        RUN_ID,
        sessionUpdate({
          sessionUpdate: "tool_call",
          toolCallId: "t1",
          kind: "execute",
          status: "pending",
          title: "bash: cat .env",
        }),
      );
      telemetry.append(
        RUN_ID,
        sessionUpdate({
          sessionUpdate: "tool_call_update",
          toolCallId: "t1",
          status: "completed",
        }),
      );
      telemetry.append(
        RUN_ID,
        makeEntry("_posthog/usage_update", {
          used: { inputTokens: 10, outputTokens: 5 },
          cost: 0.1,
        }),
      );
      telemetry.append(
        RUN_ID,
        makeEntry("_posthog/turn_complete", { stopReason: "end_turn" }),
      );
      telemetry.append(RUN_ID, makeEntry("_posthog/task_complete", {}));
    }

    it("builds a run trace: root span, turn span, tool span", async () => {
      driveSuccessfulRun();

      await telemetry.shutdown();

      const root = spanByName("task_run");
      const turn = spanByName("turn");
      const tool = spanByName("tool_call:execute");

      expect(root.kind).toBe(SpanKind.SERVER);
      expect(root.parentSpanContext).toBeUndefined();
      expect(turn.parentSpanContext?.spanId).toBe(root.spanContext().spanId);
      expect(tool.parentSpanContext?.spanId).toBe(turn.spanContext().spanId);

      const traceId = root.spanContext().traceId;
      expect(turn.spanContext().traceId).toBe(traceId);
      expect(tool.spanContext().traceId).toBe(traceId);

      expect(root.status.code).toBe(SpanStatusCode.OK);
      expect(turn.status.code).toBe(SpanStatusCode.OK);
      expect(tool.status.code).toBe(SpanStatusCode.OK);

      expect(turn.attributes).toMatchObject({
        turn_index: 1,
        stop_reason: "end_turn",
        tokens_input: 10,
        tokens_output: 5,
        cost_usd: 0.1,
      });
      expect(tool.attributes).toMatchObject({
        tool_kind: "execute",
        tool_call_id: "t1",
        tool_status: "completed",
      });

      // Same allowlist stance as logs: no prompt or tool content on spans.
      const surface = JSON.stringify(
        exportedSpans().map((span) => [span.name, span.attributes]),
      );
      expect(surface).not.toContain("SECRET");
      expect(surface).not.toContain(".env");
    });

    it("stamps log records with the span they belong to", async () => {
      driveSuccessfulRun();

      await telemetry.shutdown();

      const root = spanByName("task_run");
      const tool = spanByName("tool_call:execute");
      const logs = exportedLogs();

      const runStartedLog = logs.find((log) => log.body === "run started");
      const toolStartedLog = logs.find((log) =>
        log.body.startsWith("tool call started"),
      );
      expect(runStartedLog?.spanContext?.spanId).toBe(
        root.spanContext().spanId,
      );
      expect(toolStartedLog?.spanContext?.spanId).toBe(
        tool.spanContext().spanId,
      );
      for (const log of logs) {
        expect(log.spanContext?.traceId).toBe(root.spanContext().traceId);
      }
    });

    it("marks failed tools, errored turns, and the errored run", async () => {
      telemetry.append(RUN_ID, makeEntry("session/prompt", {}));
      telemetry.append(
        RUN_ID,
        sessionUpdate({
          sessionUpdate: "tool_call",
          toolCallId: "t1",
          kind: "execute",
        }),
      );
      telemetry.append(
        RUN_ID,
        sessionUpdate({
          sessionUpdate: "tool_call_update",
          toolCallId: "t1",
          status: "failed",
        }),
      );
      telemetry.append(
        RUN_ID,
        makeEntry("_posthog/error", {
          source: "agent_server",
          error: "gateway exploded",
        }),
      );

      await telemetry.shutdown();

      expect(spanByName("tool_call:execute").status.code).toBe(
        SpanStatusCode.ERROR,
      );
      expect(spanByName("turn").status.code).toBe(SpanStatusCode.ERROR);
      const root = spanByName("task_run");
      expect(root.status.code).toBe(SpanStatusCode.ERROR);
      expect(root.status.message).toBe("gateway exploded");
    });

    it("exports open spans on shutdown even without terminal events", async () => {
      telemetry.append(RUN_ID, makeEntry("session/prompt", {}));
      telemetry.append(
        RUN_ID,
        sessionUpdate({
          sessionUpdate: "tool_call",
          toolCallId: "t1",
          kind: "read",
        }),
      );

      await telemetry.shutdown();

      expect(
        exportedSpans()
          .map((span) => span.name)
          .sort(),
      ).toEqual(["task_run", "tool_call:read", "turn"]);
    });
  });
});
