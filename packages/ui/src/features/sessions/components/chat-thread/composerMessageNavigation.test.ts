import { describe, expect, it } from "vitest";
import {
  type ComposerNavigationAction,
  type ComposerNavigationDirection,
  composerMessageNavigation,
} from "./composerMessageNavigation";

const ids = ["m1", "m2", "m3"];

describe("composerMessageNavigation", () => {
  it.each<{
    name: string;
    focusedId: string | null;
    direction: ComposerNavigationDirection;
    expected: ComposerNavigationAction | null;
  }>([
    {
      name: "up with no focus jumps to the newest user message",
      focusedId: null,
      direction: -1,
      expected: { kind: "focus", id: "m3" },
    },
    {
      name: "up from the middle focuses the previous message",
      focusedId: "m2",
      direction: -1,
      expected: { kind: "focus", id: "m1" },
    },
    {
      name: "up at the oldest message stays on it",
      focusedId: "m1",
      direction: -1,
      expected: { kind: "focus", id: "m1" },
    },
    {
      name: "up with an unknown focus id falls back to the newest message",
      focusedId: "gone",
      direction: -1,
      expected: { kind: "focus", id: "m3" },
    },
    {
      name: "down with no focus does nothing",
      focusedId: null,
      direction: 1,
      expected: null,
    },
    {
      name: "down from the middle focuses the next message",
      focusedId: "m2",
      direction: 1,
      expected: { kind: "focus", id: "m3" },
    },
    {
      name: "down at the newest message exits back to the bottom",
      focusedId: "m3",
      direction: 1,
      expected: { kind: "exitToBottom" },
    },
    {
      name: "down with an unknown focus id does nothing",
      focusedId: "gone",
      direction: 1,
      expected: null,
    },
  ])("$name", ({ focusedId, direction, expected }) => {
    expect(composerMessageNavigation(ids, focusedId, direction)).toEqual(
      expected,
    );
  });

  it.each<{ direction: ComposerNavigationDirection }>([
    { direction: -1 },
    { direction: 1 },
  ])(
    "returns null when there are no user messages (direction $direction)",
    ({ direction }) => {
      expect(composerMessageNavigation([], null, direction)).toBeNull();
    },
  );
});
