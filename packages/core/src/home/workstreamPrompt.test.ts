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

interface PromptCase {
  name: string;
  workstream: HomeWorkstream;
  contains: string[];
  notContains: string[];
}

const contextCases: PromptCase[] = [
  {
    name: "includes repo, branch, and PR number/url/CI when a PR is present",
    workstream: makeWs({ pr: makePr() }),
    contains: [
      "- Repository: PostHog/code",
      "- Branch: feat/the-thing",
      "- Pull request #2910: Add the thing",
      "https://github.com/posthog/code/pull/2910",
      "CI: failing",
    ],
    notContains: [],
  },
  {
    name: "includes review decision and unresolved threads when set",
    workstream: makeWs({
      pr: makePr({ reviewDecision: "changes_requested", unresolvedThreads: 3 }),
    }),
    contains: ["Review: changes_requested", "Unresolved review threads: 3"],
    notContains: [],
  },
  {
    name: "omits review decision and unresolved threads when unset",
    workstream: makeWs({ pr: makePr() }),
    contains: [],
    notContains: ["Review:", "Unresolved review threads"],
  },
  {
    name: "falls back to the bare PR url when there is no PR snapshot",
    workstream: makeWs({
      pr: null,
      prUrl: "https://github.com/posthog/code/pull/42",
    }),
    contains: ["- Pull request: https://github.com/posthog/code/pull/42"],
    notContains: [],
  },
  {
    name: "emits a branch-only block when there is no PR at all",
    workstream: makeWs({ pr: null, prUrl: null, branch: "wip" }),
    contains: ["- Branch: wip"],
    notContains: ["Pull request"],
  },
];

describe("buildWorkstreamContext", () => {
  it.each(contextCases)("$name", ({ workstream, contains, notContains }) => {
    const context = buildWorkstreamContext(workstream);
    for (const text of contains) expect(context).toContain(text);
    for (const text of notContains) expect(context).not.toContain(text);
  });

  // Exact-match case (asserts emptiness, not substrings), kept separate.
  it("returns an empty string when there is nothing to anchor to", () => {
    expect(
      buildWorkstreamContext(
        makeWs({ repoFullPath: null, branch: null, pr: null, prUrl: null }),
      ),
    ).toBe("");
  });
});

const SKILL_PREFIX = "/fix-ci\n\nGet the checks green.";

const quickActionCases: PromptCase[] = [
  {
    name: "appends the workstream context after the skill prompt",
    workstream: makeWs({ pr: makePr() }),
    contains: [SKILL_PREFIX, "- Pull request #2910: Add the thing"],
    notContains: [],
  },
  {
    name: "is just the skill prompt when the workstream has no context",
    workstream: makeWs({
      repoFullPath: null,
      branch: null,
      pr: null,
      prUrl: null,
    }),
    contains: [SKILL_PREFIX],
    notContains: ["Context for this task"],
  },
];

describe("buildQuickActionPrompt", () => {
  it.each(quickActionCases)(
    "$name",
    ({ workstream, contains, notContains }) => {
      const prompt = buildQuickActionPrompt(makeAction(), workstream);
      expect(prompt.startsWith(SKILL_PREFIX)).toBe(true);
      for (const text of contains) expect(prompt).toContain(text);
      for (const text of notContains) expect(prompt).not.toContain(text);
    },
  );
});
