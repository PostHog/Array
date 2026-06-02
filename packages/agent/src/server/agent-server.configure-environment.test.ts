import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Task } from "../types";
import { AgentServer } from "./agent-server";

interface TestableServer {
  configureEnvironment(args?: {
    isInternal?: boolean;
    originProduct?: Task["origin_product"] | null;
    signalReportId?: string | null;
    taskId?: string | null;
    taskRunId?: string | null;
    taskUserId?: number | null;
  }): void;
}

const ENV_KEYS_UNDER_TEST = [
  "LLM_GATEWAY_URL",
  "ANTHROPIC_BASE_URL",
  "OPENAI_BASE_URL",
  "ANTHROPIC_CUSTOM_HEADERS",
] as const;

describe("AgentServer.configureEnvironment", () => {
  const originalEnv: Partial<Record<string, string | undefined>> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS_UNDER_TEST) {
      originalEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS_UNDER_TEST) {
      const value = originalEnv[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  const buildServer = (mode: "background" | "interactive"): TestableServer =>
    new AgentServer({
      port: 0,
      jwtPublicKey: "test-key",
      apiUrl: "https://us.posthog.com",
      apiKey: "test-api-key",
      projectId: 1,
      mode,
      taskId: "test-task-id",
      runId: "test-run-id",
    }) as unknown as TestableServer;

  it("tags as background_agents when the task is internal", () => {
    buildServer("interactive").configureEnvironment({ isInternal: true });

    expect(process.env.LLM_GATEWAY_URL).toBe(
      "https://gateway.us.posthog.com/background_agents",
    );
    expect(process.env.ANTHROPIC_BASE_URL).toBe(
      "https://gateway.us.posthog.com/background_agents",
    );
    expect(process.env.OPENAI_BASE_URL).toBe(
      "https://gateway.us.posthog.com/background_agents/v1",
    );
  });

  it("tags as posthog_code when the task is not internal", () => {
    buildServer("background").configureEnvironment({ isInternal: false });

    expect(process.env.LLM_GATEWAY_URL).toBe(
      "https://gateway.us.posthog.com/posthog_code",
    );
  });

  it("tags as posthog_code when isInternal is omitted (getTask failure fallback)", () => {
    buildServer("background").configureEnvironment();

    expect(process.env.LLM_GATEWAY_URL).toBe(
      "https://gateway.us.posthog.com/posthog_code",
    );
  });

  it("ignores mode when picking the gateway product", () => {
    buildServer("background").configureEnvironment({ isInternal: false });
    const fromBackground = process.env.LLM_GATEWAY_URL;

    buildServer("interactive").configureEnvironment({ isInternal: false });
    const fromInteractive = process.env.LLM_GATEWAY_URL;

    expect(fromBackground).toBe(fromInteractive);
    expect(fromBackground).toBe("https://gateway.us.posthog.com/posthog_code");
  });

  it("tags as signals when an internal task has origin_product 'signal_report'", () => {
    buildServer("background").configureEnvironment({
      isInternal: true,
      originProduct: "signal_report",
    });

    expect(process.env.LLM_GATEWAY_URL).toBe(
      "https://gateway.us.posthog.com/signals",
    );
    expect(process.env.ANTHROPIC_BASE_URL).toBe(
      "https://gateway.us.posthog.com/signals",
    );
    expect(process.env.OPENAI_BASE_URL).toBe(
      "https://gateway.us.posthog.com/signals/v1",
    );
  });

  it("does not tag as signals when origin_product is 'signal_report' but the task is not internal", () => {
    buildServer("background").configureEnvironment({
      isInternal: false,
      originProduct: "signal_report",
    });

    expect(process.env.LLM_GATEWAY_URL).toBe(
      "https://gateway.us.posthog.com/posthog_code",
    );
  });

  it("forwards task metadata as ANTHROPIC_CUSTOM_HEADERS", () => {
    buildServer("background").configureEnvironment({
      isInternal: true,
      originProduct: "signal_report",
      signalReportId: "report-123",
      taskId: "task-abc",
      taskRunId: "run-xyz",
      taskUserId: 42,
    });

    expect(process.env.ANTHROPIC_CUSTOM_HEADERS).toBe(
      [
        "x-posthog-property-task_origin_product: signal_report",
        "x-posthog-property-task_internal: true",
        "x-posthog-property-signal_report_id: report-123",
        "x-posthog-property-task_id: task-abc",
        "x-posthog-property-task_run_id: run-xyz",
        "x-posthog-property-task_user_id: 42",
      ].join("\n"),
    );
  });

  it("omits signal_report_id from ANTHROPIC_CUSTOM_HEADERS for non-report tasks", () => {
    buildServer("background").configureEnvironment({
      isInternal: false,
      taskId: "task-abc",
    });

    expect(process.env.ANTHROPIC_CUSTOM_HEADERS).not.toContain(
      "signal_report_id",
    );
  });

  it("omits optional task metadata from ANTHROPIC_CUSTOM_HEADERS when not provided", () => {
    buildServer("background").configureEnvironment({ isInternal: false });

    expect(process.env.ANTHROPIC_CUSTOM_HEADERS).toBe(
      "x-posthog-property-task_internal: false",
    );
  });

  it("tags as slack_app when the task was initiated from Slack", () => {
    buildServer("interactive").configureEnvironment({
      originProduct: "slack",
    });

    expect(process.env.LLM_GATEWAY_URL).toBe(
      "https://gateway.us.posthog.com/slack_app",
    );
    expect(process.env.ANTHROPIC_BASE_URL).toBe(
      "https://gateway.us.posthog.com/slack_app",
    );
    expect(process.env.OPENAI_BASE_URL).toBe(
      "https://gateway.us.posthog.com/slack_app/v1",
    );
  });

  it("prefers slack_app over background_agents when both signals are present", () => {
    buildServer("interactive").configureEnvironment({
      isInternal: true,
      originProduct: "slack",
    });

    expect(process.env.LLM_GATEWAY_URL).toBe(
      "https://gateway.us.posthog.com/slack_app",
    );
  });

  it("falls back to posthog_code for non-slack origin products", () => {
    buildServer("background").configureEnvironment({
      originProduct: "user_created",
    });

    expect(process.env.LLM_GATEWAY_URL).toBe(
      "https://gateway.us.posthog.com/posthog_code",
    );
  });

  it("respects the LLM_GATEWAY_URL override regardless of internal flag", () => {
    process.env.LLM_GATEWAY_URL = "http://ngrok.test/proxy";

    buildServer("background").configureEnvironment({ isInternal: true });

    expect(process.env.LLM_GATEWAY_URL).toBe("http://ngrok.test/proxy");
    expect(process.env.ANTHROPIC_BASE_URL).toBe("http://ngrok.test/proxy");
    expect(process.env.OPENAI_BASE_URL).toBe("http://ngrok.test/proxy/v1");
  });
});
