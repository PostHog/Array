import { describe, expect, it } from "vitest";
import type { WorkflowAction } from "../workflow/schemas";
import type { PrSnapshot } from "./prSnapshot";
import type { HomeWorkstream } from "./schemas";
import {
  buildQuickActionPrompt,
  buildSkillPrompt,
  buildWorkstreamContext,
} from "./workstreamPrompt";

function makeAction(overrides: Partial<WorkflowAction> = {}): WorkflowAction {
  return {
    id: "a1",
    label: "Fix CI",
    skillId: "fix-ci",
    prompt: "Get the checks green.",
    ...overrides,
  };
}

function makePr(overrides: Partial<PrSnapshot> = {}): PrSnapshot {
  return {
    url: "https://github.com/posthog/code/pull/2910",
    number: 2910,
    title: "Add the thing",
    state: "open",
    ciStatus: "failing",
    reviewDecision: null,
    unresolvedThreads: 0,
    mergeable: true,
    isCurrentUserRequestedReviewer: false,
    isCurrentUserAuthor: true,
    author: "peter",
    lastUpdatedAt: 0,
    ...overrides,
  };
}

function makeWs(overrides: Partial<HomeWorkstream> = {}): HomeWorkstream {
  return {
    id: "ws_1",
    repoName: "code",
    repoFullPath: "PostHog/code",
    branch: "feat/the-thing",
    prUrl: null,
    pr: null,
    tasks: [],
    situations: [],
    primarySituation: null,
    lastActivityAt: 0,
    ...overrides,
  };
}

describe("buildSkillPrompt", () => {
  it.each([
    {
      name: "prefixes the skill command and keeps the body",
      action: makeAction({ skillId: "fix-ci", prompt: "Get it green." }),
      expected: "/fix-ci\n\nGet it green.",
    },
    {
      name: "emits just the command when there is no body",
      action: makeAction({ skillId: "fix-ci", prompt: "   " }),
      expected: "/fix-ci",
    },
    {
      name: "sends the body alone when no skill is bound",
      action: makeAction({ skillId: "", prompt: "Do the work." }),
      expected: "Do the work.",
    },
  ])("$name", ({ action, expected }) => {
    expect(buildSkillPrompt(action)).toBe(expected);
  });
});

describe("buildWorkstreamContext", () => {
  it("includes the PR number, url, and CI status when a PR is present", () => {
    const context = buildWorkstreamContext(makeWs({ pr: makePr() }));
    expect(context).toContain("- Repository: PostHog/code");
    expect(context).toContain("- Branch: feat/the-thing");
    expect(context).toContain("- Pull request #2910: Add the thing");
    expect(context).toContain("https://github.com/posthog/code/pull/2910");
    expect(context).toContain("CI: failing");
  });

  it("includes review decision and unresolved threads only when set", () => {
    const withReview = buildWorkstreamContext(
      makeWs({
        pr: makePr({
          reviewDecision: "changes_requested",
          unresolvedThreads: 3,
        }),
      }),
    );
    expect(withReview).toContain("Review: changes_requested");
    expect(withReview).toContain("Unresolved review threads: 3");

    const withoutReview = buildWorkstreamContext(makeWs({ pr: makePr() }));
    expect(withoutReview).not.toContain("Review:");
    expect(withoutReview).not.toContain("Unresolved review threads");
  });

  it("falls back to the bare PR url when there is no PR snapshot", () => {
    const context = buildWorkstreamContext(
      makeWs({ pr: null, prUrl: "https://github.com/posthog/code/pull/42" }),
    );
    expect(context).toContain(
      "- Pull request: https://github.com/posthog/code/pull/42",
    );
  });

  it("emits a branch-only block when there is no PR at all", () => {
    const context = buildWorkstreamContext(
      makeWs({ pr: null, prUrl: null, branch: "wip" }),
    );
    expect(context).toContain("- Branch: wip");
    expect(context).not.toContain("Pull request");
  });

  it("returns an empty string when there is nothing to anchor to", () => {
    expect(
      buildWorkstreamContext(
        makeWs({ repoFullPath: null, branch: null, pr: null, prUrl: null }),
      ),
    ).toBe("");
  });
});

describe("buildQuickActionPrompt", () => {
  it("appends the workstream context after the skill prompt", () => {
    const prompt = buildQuickActionPrompt(
      makeAction(),
      makeWs({ pr: makePr() }),
    );
    expect(prompt.startsWith("/fix-ci\n\nGet the checks green.")).toBe(true);
    expect(prompt).toContain("- Pull request #2910: Add the thing");
  });

  it("is just the skill prompt when the workstream has no context", () => {
    const prompt = buildQuickActionPrompt(
      makeAction(),
      makeWs({ repoFullPath: null, branch: null, pr: null, prUrl: null }),
    );
    expect(prompt).toBe("/fix-ci\n\nGet the checks green.");
  });
});
