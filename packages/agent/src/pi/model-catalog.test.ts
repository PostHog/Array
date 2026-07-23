import { describe, expect, it } from "vitest";
import { resolvePosthogPiModelCatalog } from "./model-catalog";

describe("resolvePosthogPiModelCatalog", () => {
  it("uses the PostHog provider model configuration for gateway models", () => {
    const models = resolvePosthogPiModelCatalog(
      [
        {
          id: "claude-opus-4-8",
          owned_by: "anthropic",
          context_window: 1_000_000,
          supports_vision: true,
          allowed: true,
        },
        {
          id: "claude-haiku-4-5",
          owned_by: "anthropic",
          context_window: 200_000,
          supports_vision: true,
          allowed: true,
        },
        {
          id: "gpt-5.6-sol",
          owned_by: "openai",
          context_window: 1_000_000,
          supports_vision: true,
          allowed: false,
        },
      ],
      "us",
    );

    expect(models).toEqual([
      expect.objectContaining({
        provider: "posthog",
        id: "claude-opus-4-8",
        thinkingLevels: expect.arrayContaining(["off", "high", "xhigh"]),
      }),
      expect.objectContaining({
        provider: "posthog",
        id: "claude-haiku-4-5",
      }),
    ]);
  });
});
