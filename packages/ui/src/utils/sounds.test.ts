import type {
  CompletionSound,
  CustomSound,
} from "@posthog/ui/features/settings/settingsStore";
import { describe, expect, it } from "vitest";
import { resolveSoundUrl } from "./sounds";

const customs: CustomSound[] = [
  {
    id: "abc",
    name: "My ding",
    dataUrl: "data:audio/wav;base64,AAAA",
    durationMs: 800,
  },
];

describe("resolveSoundUrl", () => {
  it("returns null for 'none'", () => {
    expect(resolveSoundUrl("none", [])).toBeNull();
  });

  it("returns a bundled asset URL for a built-in sound", () => {
    const url = resolveSoundUrl("guitar", []);
    expect(typeof url).toBe("string");
    expect(url).toBeTruthy();
  });

  it("returns null for an unknown built-in", () => {
    expect(resolveSoundUrl("bogus" as CompletionSound, [])).toBeNull();
  });

  it("resolves a custom sound id to its inline data URL", () => {
    expect(resolveSoundUrl("custom:abc", customs)).toBe(
      "data:audio/wav;base64,AAAA",
    );
  });

  it("returns null when the custom id is no longer installed", () => {
    // e.g. the active sound was deleted from the library.
    expect(resolveSoundUrl("custom:gone", customs)).toBeNull();
  });
});
