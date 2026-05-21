import { describe, expect, it } from "vitest";
import { chunkFileChanges, OversizedFileError } from "./signed-commit";

function addition(path: string, sizeBytes: number) {
  // base64 string of roughly `sizeBytes` length stands in for file contents.
  return { path, contents: "a".repeat(sizeBytes) };
}

describe("chunkFileChanges", () => {
  it.each([
    {
      name: "carries deletions in a single chunk when there are no additions",
      changes: { additions: [], deletions: [{ path: "gone.txt" }] },
      limit: 1000,
      expected: [{ additions: [], deletions: ["gone.txt"] }],
    },
    {
      name: "packs additions under the threshold into one chunk",
      changes: {
        additions: [addition("a", 100), addition("b", 100), addition("c", 100)],
        deletions: [],
      },
      limit: 10_000,
      expected: [{ additions: ["a", "b", "c"], deletions: [] }],
    },
    {
      name: "splits additions across chunks, with deletions in the first only",
      changes: {
        additions: [addition("a", 400), addition("b", 400), addition("c", 400)],
        deletions: [{ path: "d" }],
      },
      limit: 500,
      // Each ~400-byte addition needs its own chunk at a 500-byte budget.
      expected: [
        { additions: ["a"], deletions: ["d"] },
        { additions: ["b"], deletions: [] },
        { additions: ["c"], deletions: [] },
      ],
    },
  ])("$name", ({ changes, limit, expected }) => {
    const chunks = chunkFileChanges(changes, limit);
    expect(
      chunks.map((c) => ({
        additions: c.additions.map((a) => a.path),
        deletions: c.deletions.map((d) => d.path),
      })),
    ).toEqual(expected);
  });

  it("throws OversizedFileError for a single file larger than the limit", () => {
    expect(() =>
      chunkFileChanges(
        { additions: [addition("huge", 5000)], deletions: [] },
        1000,
      ),
    ).toThrow(OversizedFileError);
  });
});
