import { describe, expect, it } from "vitest";
import { resolveLocalSpokenNarration } from "./spokenNarration";

describe("resolveLocalSpokenNarration", () => {
  it("enables narration only when flag, setting and key are all present", () => {
    expect(
      resolveLocalSpokenNarration({
        spokenNarrationFlagEnabled: true,
        spokenNotifications: true,
        elevenLabsKeyConfigured: true,
      }),
    ).toBe(true);
  });

  it.each([
    {
      name: "flag off",
      settings: {
        spokenNarrationFlagEnabled: false,
        spokenNotifications: true,
        elevenLabsKeyConfigured: true,
      },
    },
    {
      name: "flag unset (host without flags)",
      settings: {
        spokenNotifications: true,
        elevenLabsKeyConfigured: true,
      },
    },
    {
      name: "setting off",
      settings: {
        spokenNarrationFlagEnabled: true,
        spokenNotifications: false,
        elevenLabsKeyConfigured: true,
      },
    },
    {
      name: "no ElevenLabs key",
      settings: {
        spokenNarrationFlagEnabled: true,
        spokenNotifications: true,
        elevenLabsKeyConfigured: false,
      },
    },
    { name: "everything unset", settings: {} },
  ])("stays off with $name", ({ settings }) => {
    expect(resolveLocalSpokenNarration(settings)).toBe(false);
  });
});
