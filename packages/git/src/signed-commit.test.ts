import { describe, expect, it } from "vitest";
import {
  chunkFileChanges,
  detectBaseLeaks,
  interpretMergeApiResult,
  OversizedFileError,
  operationInProgressError,
  parseRawDiffZ,
  type RawDiffEntry,
  splitCommitMessage,
} from "./signed-commit";

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

describe("splitCommitMessage", () => {
  it.each([
    {
      name: "subject only",
      raw: "fix: handle null",
      expected: { headline: "fix: handle null", body: "" },
    },
    {
      name: "subject + body, dropping the blank separator line",
      raw: "feat: add thing\n\nDetails here.\nMore details.",
      expected: {
        headline: "feat: add thing",
        body: "Details here.\nMore details.",
      },
    },
    {
      name: "preserves existing trailers in the body",
      raw: "fix: x\n\nGenerated-By: PostHog Code\nTask-Id: abc",
      expected: {
        headline: "fix: x",
        body: "Generated-By: PostHog Code\nTask-Id: abc",
      },
    },
    {
      name: "trims trailing whitespace",
      raw: "chore: y\n\nbody\n\n",
      expected: { headline: "chore: y", body: "body" },
    },
  ])("$name", ({ raw, expected }) => {
    expect(splitCommitMessage(raw)).toEqual(expected);
  });
});

const ZERO_OID = "0".repeat(40);
const OID_A = "a".repeat(40);
const OID_B = "b".repeat(40);

function rawEntry(
  status: string,
  path: string,
  oldOid: string,
  newOid: string,
): string {
  return `:100644 100644 ${oldOid} ${newOid} ${status}\0${path}\0`;
}

describe("parseRawDiffZ", () => {
  it.each([
    {
      name: "modification",
      input: rawEntry("M", "src/file.ts", OID_A, OID_B),
      expected: [
        { path: "src/file.ts", oldOid: OID_A, newOid: OID_B, status: "M" },
      ],
    },
    {
      name: "addition",
      input: rawEntry("A", "new.ts", ZERO_OID, OID_A),
      expected: [
        { path: "new.ts", oldOid: ZERO_OID, newOid: OID_A, status: "A" },
      ],
    },
    {
      name: "deletion has the all-zeros new OID",
      input: rawEntry("D", "gone.ts", OID_A, ZERO_OID),
      expected: [
        { path: "gone.ts", oldOid: OID_A, newOid: ZERO_OID, status: "D" },
      ],
    },
    {
      name: "type change",
      input: rawEntry("T", "link", OID_A, OID_B),
      expected: [{ path: "link", oldOid: OID_A, newOid: OID_B, status: "T" }],
    },
    {
      name: "multiple entries",
      input:
        rawEntry("M", "a.ts", OID_A, OID_B) +
        rawEntry("D", "b with spaces.ts", OID_B, ZERO_OID),
      expected: [
        { path: "a.ts", oldOid: OID_A, newOid: OID_B, status: "M" },
        {
          path: "b with spaces.ts",
          oldOid: OID_B,
          newOid: ZERO_OID,
          status: "D",
        },
      ],
    },
    { name: "empty input", input: "", expected: [] },
  ])("$name", ({ input, expected }) => {
    expect(parseRawDiffZ(input)).toEqual(expected);
  });
});

describe("detectBaseLeaks", () => {
  const staged = (path: string, newOid: string): RawDiffEntry => ({
    path,
    oldOid: OID_A,
    newOid,
    status: newOid === ZERO_OID ? "D" : "M",
  });

  it.each([
    {
      name: "flags a staged file matching base content outside the PR diff",
      staged: [staged("leaked.ts", OID_B)],
      prFiles: new Set<string>(),
      baseChanged: new Map([["leaked.ts", OID_B]]),
      expected: ["leaked.ts"],
    },
    {
      name: "exempts files already in the PR diff",
      staged: [staged("mine.ts", OID_B)],
      prFiles: new Set(["mine.ts"]),
      baseChanged: new Map([["mine.ts", OID_B]]),
      expected: [],
    },
    {
      name: "exempts genuine edits to a base-touched file (OID differs)",
      staged: [staged("contested.ts", OID_A)],
      prFiles: new Set<string>(),
      baseChanged: new Map([["contested.ts", OID_B]]),
      expected: [],
    },
    {
      name: "flags a staged deletion matching a base-side deletion",
      staged: [staged("removed-on-base.ts", ZERO_OID)],
      prFiles: new Set<string>(),
      baseChanged: new Map([["removed-on-base.ts", ZERO_OID]]),
      expected: ["removed-on-base.ts"],
    },
    {
      name: "passes a PR-authored deletion of a base-untouched file",
      staged: [staged("mine-to-delete.ts", ZERO_OID)],
      prFiles: new Set<string>(),
      baseChanged: new Map<string, string>(),
      expected: [],
    },
    {
      name: "empty staged set yields no leaks",
      staged: [],
      prFiles: new Set<string>(),
      baseChanged: new Map([["x.ts", OID_B]]),
      expected: [],
    },
    {
      name: "mixed: only the base-matching outsider is flagged",
      staged: [
        staged("leaked.ts", OID_B),
        staged("mine.ts", OID_B),
        staged("edited.ts", OID_A),
      ],
      prFiles: new Set(["mine.ts"]),
      baseChanged: new Map([
        ["leaked.ts", OID_B],
        ["mine.ts", OID_B],
        ["edited.ts", OID_B],
      ]),
      expected: ["leaked.ts"],
    },
  ])("$name", ({ staged, prFiles, baseChanged, expected }) => {
    expect(detectBaseLeaks(staged, prFiles, baseChanged)).toEqual(expected);
  });
});

describe("operationInProgressError", () => {
  it("explains linearization and both recovery paths for a merge", () => {
    const msg = operationInProgressError("merge");
    expect(msg).toContain("MERGE_HEAD");
    expect(msg).toContain("LINEARIZE");
    expect(msg).toContain("git merge --abort");
    expect(msg).toContain("git_signed_merge");
    expect(msg).toContain("git_signed_rewrite");
  });

  it("directs a rebase to --continue and git_signed_rewrite", () => {
    const msg = operationInProgressError("rebase");
    expect(msg).toContain("git rebase --continue");
    expect(msg).toContain("git_signed_rewrite");
  });

  it("directs a cherry-pick to --continue/--abort", () => {
    const msg = operationInProgressError("cherry-pick");
    expect(msg).toContain("git cherry-pick --continue");
  });
});

describe("interpretMergeApiResult", () => {
  it.each([
    {
      name: "201 with a body is merged",
      res: {
        stdout: JSON.stringify({
          sha: OID_A,
          html_url: "https://github.com/o/r/commit/a",
        }),
        stderr: "",
        exitCode: 0,
      },
      expected: {
        kind: "merged",
        sha: OID_A,
        url: "https://github.com/o/r/commit/a",
      },
    },
    {
      name: "204 (empty body) is up-to-date",
      res: { stdout: "", stderr: "", exitCode: 0 },
      expected: { kind: "up-to-date" },
    },
    {
      name: "whitespace-only body is up-to-date",
      res: { stdout: "\n", stderr: "", exitCode: 0 },
      expected: { kind: "up-to-date" },
    },
    {
      name: "HTTP 409 is a conflict",
      res: {
        stdout: "",
        stderr: "gh: Merge conflict (HTTP 409)",
        exitCode: 1,
      },
      expected: { kind: "conflict" },
    },
    {
      name: "HTTP 404 is forbidden",
      res: { stdout: "", stderr: "gh: Not Found (HTTP 404)", exitCode: 1 },
      expected: { kind: "forbidden" },
    },
    {
      name: "HTTP 403 is forbidden",
      res: { stdout: "", stderr: "gh: Forbidden (HTTP 403)", exitCode: 1 },
      expected: { kind: "forbidden" },
    },
    {
      name: "other failures surface the stderr",
      res: { stdout: "", stderr: "boom", exitCode: 1 },
      expected: { kind: "error", message: "boom" },
    },
  ])("$name", ({ res, expected }) => {
    expect(interpretMergeApiResult(res)).toEqual(expected);
  });

  it("treats a 200 body without a sha as an error", () => {
    const outcome = interpretMergeApiResult({
      stdout: JSON.stringify({ message: "weird" }),
      stderr: "",
      exitCode: 0,
    });
    expect(outcome.kind).toBe("error");
  });

  it("treats non-JSON success output as an error", () => {
    const outcome = interpretMergeApiResult({
      stdout: "<html>proxy error</html>",
      stderr: "",
      exitCode: 0,
    });
    expect(outcome.kind).toBe("error");
  });
});
