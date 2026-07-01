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

  it.each([
    ["darwin", 'sandbox_mode="workspace-write"'],
    ["linux", 'sandbox_mode="danger-full-access"'],
    ["win32", 'sandbox_mode="danger-full-access"'],
  ])(
    "on %s spawns with %s (macOS keeps the sandbox engaged so read-only can restrict; cloud/linux avoids the linux-sandbox panic)",
    (platform, expected) => {
      const original = process.platform;
      Object.defineProperty(process, "platform", {
        value: platform,
        configurable: true,
      });
      try {
        const args = buildAppServerArgs({ binaryPath: "/bundle/codex" });
        expect(args).toContain(expected);
        expect(
          args.filter((a) => a.startsWith("sandbox_mode=")),
        ).toHaveLength(1);
      } finally {
        Object.defineProperty(process, "platform", {
          value: original,
          configurable: true,
        });
      }
    },
  );

  it("does not set instructions at spawn (developer_instructions are per-thread)", () => {
    const args = buildAppServerArgs({
      binaryPath: "/bundle/codex",
      developerInstructions: "Follow PostHog rules.",
    });

    expect(args.some((arg) => arg.startsWith("developer_instructions="))).toBe(
      false,
    );
    expect(args.some((arg) => arg.startsWith("instructions="))).toBe(false);
  });
});
