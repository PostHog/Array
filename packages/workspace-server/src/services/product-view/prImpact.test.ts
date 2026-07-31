import { describe, expect, it } from "vitest";
import {
  aggregateMergedPrs,
  extractPrNumber,
  filterOpenPrsByFiles,
  parseGithubRemote,
} from "./prImpact";

describe("extractPrNumber", () => {
  it.each([
    ["feat(tabs): add product tab (#3944)", 3944],
    ["fix: a thing (#12) (#13)", 13], // squash of a squash — last wins
    ["Merge pull request #55 from x/y", 55],
    ["plain subject with no PR", null],
    ["not a ref #123 mid-sentence", null],
  ])("%s → %s", (subject, expected) => {
    expect(extractPrNumber(subject)).toBe(expected);
  });
});

describe("parseGithubRemote", () => {
  it.each([
    [
      "https://github.com/PostHog/posthog.git",
      { owner: "PostHog", repo: "posthog" },
    ],
    [
      "git@github.com:PostHog/posthog.git",
      { owner: "PostHog", repo: "posthog" },
    ],
    [
      "https://github.com/PostHog/posthog",
      { owner: "PostHog", repo: "posthog" },
    ],
    ["https://gitlab.com/x/y.git", null],
    ["nonsense", null],
  ])("%s", (remote, expected) => {
    expect(parseGithubRemote(remote)).toEqual(expected);
  });
});

describe("aggregateMergedPrs", () => {
  it("dedupes by PR number keeping the newest commit date, newest first", () => {
    const merged = aggregateMergedPrs(
      [
        { subject: "feat: one (#10)", date: "2026-07-01" },
        { subject: "fix: follow-up (#10)", date: "2026-07-10" },
        { subject: "feat: two (#20)", date: "2026-07-05" },
        { subject: "chore: no pr", date: "2026-07-06" },
      ],
      { owner: "PostHog", repo: "posthog" },
    );
    expect(merged).toEqual([
      {
        number: 10,
        title: "fix: follow-up",
        url: "https://github.com/PostHog/posthog/pull/10",
        lastCommitDate: "2026-07-10",
      },
      {
        number: 20,
        title: "feat: two",
        url: "https://github.com/PostHog/posthog/pull/20",
        lastCommitDate: "2026-07-05",
      },
    ]);
  });
});

describe("filterOpenPrsByFiles", () => {
  const prs = [
    { number: 1, title: "a", url: "u1", files: ["src/a.ts", "src/b.ts"] },
    { number: 2, title: "b", url: "u2", files: ["docs/readme.md"] },
  ];
  it("keeps only PRs touching one of the given files", () => {
    expect(
      filterOpenPrsByFiles(prs, ["src/b.ts", "src/z.ts"]).map((p) => p.number),
    ).toEqual([1]);
  });
  it("returns empty when nothing overlaps", () => {
    expect(filterOpenPrsByFiles(prs, ["nope.ts"])).toEqual([]);
  });
});
