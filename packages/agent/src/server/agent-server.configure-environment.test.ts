import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentServer } from "./agent-server";

interface TestableServer {
  configureEnvironment(args?: { isInternal?: boolean }): void;
}

const ENV_KEYS_UNDER_TEST = [
  "LLM_GATEWAY_URL",
  "ANTHROPIC_BASE_URL",
  "OPENAI_BASE_URL",
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

  it("respects the LLM_GATEWAY_URL override regardless of internal flag", () => {
    process.env.LLM_GATEWAY_URL = "http://ngrok.test/proxy";

    buildServer("background").configureEnvironment({ isInternal: true });

    expect(process.env.LLM_GATEWAY_URL).toBe("http://ngrok.test/proxy");
    expect(process.env.ANTHROPIC_BASE_URL).toBe("http://ngrok.test/proxy");
    expect(process.env.OPENAI_BASE_URL).toBe("http://ngrok.test/proxy/v1");
  });
});
