import { describe, expect, it } from "vitest";
import { buildAppServerArgs } from "./spawn";

describe("buildAppServerArgs", () => {
  it("launches the app-server subcommand routed through the PostHog gateway", () => {
    const args = buildAppServerArgs({
      binaryPath: "/bundle/codex",
      apiBaseUrl: "https://gateway.example/v1",
    });

    expect(args[0]).toBe("app-server");
    expect(args).toContain('model_provider="posthog"');
    expect(args).toContain(
      'model_providers.posthog.base_url="https://gateway.example/v1"',
    );
    expect(args).toContain('model_providers.posthog.wire_api="responses"');
    expect(args).toContain(
      'model_providers.posthog.env_key="POSTHOG_GATEWAY_API_KEY"',
    );
  });

  it("passes guidance via developer_instructions, never the replacing key", () => {
    const args = buildAppServerArgs({
      binaryPath: "/bundle/codex",
      developerInstructions: "Follow PostHog rules.",
    });

    expect(args).toContain('developer_instructions="Follow PostHog rules."');
    expect(args.some((arg) => arg.startsWith("instructions="))).toBe(false);
  });
});
