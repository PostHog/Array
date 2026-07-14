import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OtelLogWriter } from "./otel-log-writer";
import type { StoredNotification } from "./types";

// Mock the OTEL exporter
const mockExport = vi.fn((_logs, callback) => {
  callback({ code: 0 }); // Success
});

vi.mock("@opentelemetry/exporter-logs-otlp-http", () => ({
  OTLPLogExporter: class {
    export = mockExport;
    shutdown = vi.fn().mockResolvedValue(undefined);
  },
}));

describe("OtelLogWriter", () => {
  let writer: OtelLogWriter;

  beforeEach(() => {
    mockExport.mockClear();
    // Session context (taskId, runId) is now passed in constructor as resource attributes
    writer = new OtelLogWriter(
      {
        posthogHost: "https://us.i.posthog.com",
        apiKey: "phc_test_key",
        flushIntervalMs: 100,
      },
      {
        taskId: "task-123",
        runId: "run-456",
      },
    );
  });

  afterEach(async () => {
    await writer.shutdown();
  });

  it("should emit a log entry with event_type as regular attribute", async () => {
    const notification: StoredNotification = {
      type: "notification",
      timestamp: new Date().toISOString(),
      notification: {
        jsonrpc: "2.0",
        method: "_posthog/test_event",
        params: { foo: "bar" },
      },
    };

    // taskId and runId are now resource attributes set in constructor,
    // only notification is passed per-emit
    writer.emit({ notification });

    // Force flush to trigger export
    await writer.flush();

    // Verify export was called
    expect(mockExport).toHaveBeenCalled();

    // Get the logs that were exported
    const exportedLogs = mockExport.mock.calls[0][0];
    expect(exportedLogs.length).toBe(1);

    const log = exportedLogs[0];
    // task_id and run_id are now resource attributes, not regular attributes
    expect(log.attributes.task_id).toBeUndefined();
    expect(log.attributes.run_id).toBeUndefined();
    // event_type is still a regular attribute (varies per log entry)
    expect(log.attributes.event_type).toBe("_posthog/test_event");
    expect(log.body).toBe(JSON.stringify(notification));

    // Verify resource attributes contain task_id and run_id
    expect(log.resource.attributes.task_id).toBe("task-123");
    expect(log.resource.attributes.run_id).toBe("run-456");
    expect(log.resource.attributes["service.name"]).toBe("posthog-code-agent");
  });

  it("should batch multiple log entries", async () => {
    const makeNotification = (method: string): StoredNotification => ({
      type: "notification",
      timestamp: new Date().toISOString(),
      notification: {
        jsonrpc: "2.0",
        method,
      },
    });

    writer.emit({ notification: makeNotification("event_1") });
    writer.emit({ notification: makeNotification("event_2") });
    writer.emit({ notification: makeNotification("event_3") });

    await writer.flush();

    expect(mockExport).toHaveBeenCalled();
    const exportedLogs = mockExport.mock.calls[0][0];
    expect(exportedLogs.length).toBe(3);

    // All logs should share the same resource attributes
    for (const log of exportedLogs) {
      expect(log.resource.attributes.task_id).toBe("task-123");
      expect(log.resource.attributes.run_id).toBe("run-456");
    }
  });
});
