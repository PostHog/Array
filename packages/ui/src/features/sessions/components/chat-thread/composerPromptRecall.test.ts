import { describe, expect, it } from "vitest";
import {
  type PromptRecallAction,
  type PromptRecallDirection,
  promptRecallStep,
} from "./composerPromptRecall";

const ids = ["m1", "m2", "m3"];

describe("promptRecallStep", () => {
  it.each<{
    name: string;
    currentId: string | null;
    direction: PromptRecallDirection;
    expected: PromptRecallAction | null;
  }>([
    {
      name: "up with no recall in progress starts fresh on the newest prompt",
      currentId: null,
      direction: -1,
      expected: { kind: "recall", id: "m3", fresh: true },
    },
    {
      name: "up from the middle recalls the previous prompt",
      currentId: "m2",
      direction: -1,
      expected: { kind: "recall", id: "m1", fresh: false },
    },
    {
      name: "up at the oldest prompt stays on it",
      currentId: "m1",
      direction: -1,
      expected: { kind: "recall", id: "m1", fresh: false },
    },
    {
      name: "up with an unknown current id starts fresh on the newest prompt",
      currentId: "gone",
      direction: -1,
      expected: { kind: "recall", id: "m3", fresh: true },
    },
    {
      name: "down with no recall in progress does nothing",
      currentId: null,
      direction: 1,
      expected: null,
    },
    {
      name: "down from the middle recalls the next prompt",
      currentId: "m2",
      direction: 1,
      expected: { kind: "recall", id: "m3", fresh: false },
    },
    {
      name: "down at the newest prompt exits recall",
      currentId: "m3",
      direction: 1,
      expected: { kind: "exit" },
    },
    {
      name: "down with an unknown current id does nothing",
      currentId: "gone",
      direction: 1,
      expected: null,
    },
  ])("$name", ({ currentId, direction, expected }) => {
    expect(promptRecallStep(ids, currentId, direction)).toEqual(expected);
  });

  it.each<{ direction: PromptRecallDirection }>([
    { direction: -1 },
    { direction: 1 },
  ])(
    "returns null when no prompts were sent (direction $direction)",
    ({ direction }) => {
      expect(promptRecallStep([], null, direction)).toBeNull();
    },
  );
});
