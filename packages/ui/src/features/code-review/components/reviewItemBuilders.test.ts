import type { ChangedFile } from "@posthog/shared/domain-types";
import { describe, expect, it } from "vitest";
import type { ReviewListItem } from "../commentFileFilter";
import {
  changedFileSignature,
  orderPathsLikeTree,
  patchFileSignature,
  sortReviewItemsByTreeOrder,
} from "./reviewItemBuilders";

const changedFile = (over: Partial<ChangedFile>): ChangedFile => ({
  path: "a.ts",
  status: "modified",
  ...over,
});

describe("changedFileSignature", () => {
  it("differs when the patch content differs", () => {
    const a = changedFileSignature(
      changedFile({ patch: "@@ -1 +1 @@\n-x\n+y" }),
    );
    const b = changedFileSignature(
      changedFile({ patch: "@@ -1 +1 @@\n-x\n+z" }),
    );
    expect(a).not.toBe(b);
  });

  it("uses the blob sha when no patch is available", () => {
    expect(changedFileSignature(changedFile({ sha: "abc" }))).toBe(
      "modified:abc",
    );
    expect(changedFileSignature(changedFile({ sha: "def" }))).toBe(
      "modified:def",
    );
  });

  it("returns no signature without patch content or a blob sha", () => {
    expect(
      changedFileSignature(changedFile({ linesAdded: 1, linesRemoved: 2 })),
    ).toBeNull();
  });
});

describe("patchFileSignature", () => {
  // biome-ignore lint/suspicious/noExplicitAny: minimal pierre FileDiff stub
  const fileDiff = (over: Record<string, unknown>): any => ({
    hunks: [],
    ...over,
  });

  it("uses git blob object ids and ignores hunk content (whitespace-stable)", () => {
    // Same blob ids, different parsed hunks (as the hide-whitespace toggle
    // would produce) must yield the same signature.
    const a = patchFileSignature(
      fileDiff({ prevObjectId: "aaa", newObjectId: "bbb", hunks: [{ x: 1 }] }),
    );
    const b = patchFileSignature(
      fileDiff({
        prevObjectId: "aaa",
        newObjectId: "bbb",
        hunks: [{ x: 2, y: 3 }],
      }),
    );
    expect(a).toBe("aaa:bbb");
    expect(b).toBe("aaa:bbb");
  });

  it("changes when the new blob id changes", () => {
    const a = patchFileSignature(
      fileDiff({ prevObjectId: "aaa", newObjectId: "bbb" }),
    );
    const b = patchFileSignature(
      fileDiff({ prevObjectId: "aaa", newObjectId: "ccc" }),
    );
    expect(a).not.toBe(b);
  });

  it("falls back to hashing hunks when object ids are absent", () => {
    const a = patchFileSignature(fileDiff({ hunks: [{ additionLines: 1 }] }));
    const b = patchFileSignature(fileDiff({ hunks: [{ additionLines: 2 }] }));
    expect(a).not.toBe(b);
  });
});

describe("orderPathsLikeTree", () => {
  it("orders paths like the file tree, not git byte order", () => {
    expect(
      orderPathsLikeTree([
        "Beta.txt",
        "ZETA_CAPS.txt",
        "alpha.txt",
        "src/Apple.ts",
        "src/beta.ts",
        "zeta.txt",
      ]),
    ).toEqual([
      "src/Apple.ts",
      "src/beta.ts",
      "alpha.txt",
      "Beta.txt",
      "ZETA_CAPS.txt",
      "zeta.txt",
    ]);
  });
});

describe("sortReviewItemsByTreeOrder", () => {
  const item = (key: string, filePaths: string[]): ReviewListItem => ({
    key,
    filePaths,
    node: null,
  });

  it("reorders file items to match the given tree order", () => {
    const items = [
      item("a", ["zeta.txt"]),
      item("b", ["alpha.txt"]),
      item("c", ["src/x.ts"]),
    ];
    const ordered = sortReviewItemsByTreeOrder(items, [
      "src/x.ts",
      "alpha.txt",
      "zeta.txt",
    ]);
    expect(ordered.map((i) => i.key)).toEqual(["c", "b", "a"]);
  });

  it("keeps items whose path is not in the order last", () => {
    const items = [item("a", ["unknown.ts"]), item("b", ["alpha.txt"])];
    const ordered = sortReviewItemsByTreeOrder(items, ["alpha.txt"]);
    expect(ordered.map((i) => i.key)).toEqual(["b", "a"]);
  });

  it("returns the same array when there is no tree order", () => {
    const items = [item("a", ["zeta.txt"]), item("b", ["alpha.txt"])];
    expect(sortReviewItemsByTreeOrder(items, [])).toBe(items);
  });
});
