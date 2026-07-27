import { describe, expect, it } from "vitest";
import { isPrivateChannel } from "./channelGlyph";

describe("isPrivateChannel", () => {
  it.each([
    ["me", true],
    ["  Me  ", true],
    ["ME", true],
    ["code", false],
    ["posthog-feedback", false],
    // Not a prefix match: only the personal channel itself is private.
    ["meeting-notes", false],
    ["team-me", false],
    [undefined, false],
    ["", false],
  ])("%s -> %s", (name, expected) => {
    expect(isPrivateChannel(name)).toBe(expected);
  });
});
