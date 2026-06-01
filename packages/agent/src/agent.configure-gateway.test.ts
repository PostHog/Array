import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Agent } from "./agent";

interface TestableAgent {
  _configureLlmGateway(
    overrideUrl?: string,
  ): Promise<{ gatewayUrl: string; apiKey: string } | null>;
}

const ENV_KEYS_UNDER_TEST = [
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_CUSTOM_HEADERS",
  "OPENAI_BASE_URL",
  "OPENAI_API_KEY",
] as const;

describe("Agent._configureLlmGateway", () => {
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

  const buildAgent = (): TestableAgent =>
    new Agent({
      skipLogPersistence: true,
      posthog: {
        apiUrl: "https://us.posthog.com",
        getApiKey: vi.fn().mockResolvedValue("test-token"),
        projectId: 99,
      },
    }) as unknown as TestableAgent;

  it("forwards the team_id as an x-posthog-property header", async () => {
    await buildAgent()._configureLlmGateway();

    expect(process.env.ANTHROPIC_CUSTOM_HEADERS).toBe(
      "x-posthog-property-team_id: 99",
    );
  });

  it("preserves pre-existing custom headers and dedupes the team_id line", async () => {
    process.env.ANTHROPIC_CUSTOM_HEADERS = [
      "x-posthog-property-team_id: 1",
      "x-posthog-use-bedrock-fallback: true",
    ].join("\n");

    await buildAgent()._configureLlmGateway();

    expect(process.env.ANTHROPIC_CUSTOM_HEADERS).toBe(
      [
        "x-posthog-property-team_id: 99",
        "x-posthog-use-bedrock-fallback: true",
      ].join("\n"),
    );
  });
});
