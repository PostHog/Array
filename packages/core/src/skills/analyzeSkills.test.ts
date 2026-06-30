import type { SkillInfo } from "@posthog/shared";
import { describe, expect, it } from "vitest";
import {
  AMBIGUOUS_TRIGGER_VERBS,
  analyzeSkills,
  hasAmbiguousTrigger,
  OVERSIZED_SKILL_MD_BYTES,
} from "./analyzeSkills";

function makeSkill(overrides: Partial<SkillInfo>): SkillInfo {
  return {
    name: "my-skill",
    description: "Does a thing",
    source: "user",
    path: "/home/.claude/skills/my-skill",
    editable: true,
    skillMdBytes: 1024,
    ...overrides,
  };
}

describe("analyzeSkills", () => {
  it("returns no issues for a healthy skill", () => {
    expect(analyzeSkills([makeSkill({})])).toEqual({});
  });

  it.each([
    ["empty description", ""],
    ["whitespace description", "   "],
  ])("flags a missing description: %s", (_label, description) => {
    const skill = makeSkill({ description });

    const analysis = analyzeSkills([skill]);

    expect(analysis[skill.path]).toEqual([
      expect.objectContaining({ type: "missing-description" }),
    ]);
  });

  it("flags a frontmatter name that differs from the directory name", () => {
    const skill = makeSkill({
      name: "Pretty Name",
      path: "/home/.claude/skills/my-skill",
    });

    const analysis = analyzeSkills([skill]);

    expect(analysis[skill.path]).toEqual([
      expect.objectContaining({ type: "name-mismatch" }),
    ]);
  });

  it("flags an oversized SKILL.md", () => {
    const skill = makeSkill({ skillMdBytes: OVERSIZED_SKILL_MD_BYTES + 1 });

    const analysis = analyzeSkills([skill]);

    expect(analysis[skill.path]).toEqual([
      expect.objectContaining({ type: "oversized-manifest" }),
    ]);
  });

  it("does not flag SKILL.md exactly at the size limit", () => {
    const skill = makeSkill({ skillMdBytes: OVERSIZED_SKILL_MD_BYTES });

    expect(analyzeSkills([skill])).toEqual({});
  });

  describe("shadowing", () => {
    it.each([
      ["repo", "user"],
      ["repo", "marketplace"],
      ["repo", "bundled"],
      ["user", "marketplace"],
      ["user", "bundled"],
      ["marketplace", "bundled"],
    ] as const)("%s shadows %s", (winnerSource, loserSource) => {
      const winner = makeSkill({
        source: winnerSource,
        path: `/roots/${winnerSource}/my-skill`,
      });
      const loser = makeSkill({
        source: loserSource,
        path: `/roots/${loserSource}/my-skill`,
      });

      const analysis = analyzeSkills([loser, winner]);

      expect(analysis[winner.path]).toBeUndefined();
      expect(analysis[loser.path]).toEqual([
        expect.objectContaining({ type: "shadowed" }),
      ]);
    });

    it("does not flag skills with distinct names", () => {
      const a = makeSkill({ name: "alpha", path: "/roots/user/alpha" });
      const b = makeSkill({
        name: "beta",
        path: "/roots/repo/beta",
        source: "repo",
      });

      expect(analyzeSkills([a, b])).toEqual({});
    });

    it("flags the later repo when two open repos share a skill name", () => {
      const first = makeSkill({
        source: "repo",
        repoName: "repo-a",
        path: "/roots/repo-a/.claude/skills/my-skill",
      });
      const second = makeSkill({
        source: "repo",
        repoName: "repo-b",
        path: "/roots/repo-b/.claude/skills/my-skill",
      });

      const analysis = analyzeSkills([first, second]);

      expect(analysis[first.path]).toBeUndefined();
      expect(analysis[second.path]?.[0]?.message).toContain("repo-a");
    });

    it("marks every loser when three sources collide", () => {
      const repo = makeSkill({ source: "repo", path: "/roots/repo/my-skill" });
      const user = makeSkill({ source: "user", path: "/roots/user/my-skill" });
      const bundled = makeSkill({
        source: "bundled",
        path: "/roots/bundled/my-skill",
        editable: false,
      });

      const analysis = analyzeSkills([bundled, user, repo]);

      expect(analysis[repo.path]).toBeUndefined();
      expect(analysis[user.path]?.[0]?.message).toContain("repository");
      expect(analysis[bundled.path]?.[0]?.message).toContain("repository");
    });
  });

  describe("ambiguous-trigger", () => {
    it("flags a bundled skill with an ambiguous verb and no TRIGGER guard", () => {
      const skill = makeSkill({
        source: "bundled",
        description: "Investigate why a metric dropped using PostHog data.",
      });

      const analysis = analyzeSkills([skill]);

      expect(analysis[skill.path]).toEqual([
        expect.objectContaining({ type: "ambiguous-trigger" }),
      ]);
    });

    it.each(["user", "repo", "marketplace", "codex"] as const)(
      "does not flag a %s skill — guard requirement is bundled-only",
      (source) => {
        const skill = makeSkill({
          source,
          description: "Investigate why a metric dropped.",
        });

        expect(analyzeSkills([skill])).toEqual({});
      },
    );

    it("does not flag a bundled skill whose description has a TRIGGER guard", () => {
      const skill = makeSkill({
        source: "bundled",
        description:
          "Investigate the experiment results.\nTRIGGER when: user provides an experiment ID.\nDO NOT TRIGGER when: user is editing code.",
      });

      expect(analyzeSkills([skill])).toEqual({});
    });

    it.each([
      [
        "Use when",
        "Investigates a PostHog error. Use when the user pastes an issue URL.",
      ],
      [
        "Use whenever",
        "Debug PostHog Surveys. Use whenever a support ticket is pasted.",
      ],
      [
        "Read when",
        "Audit PostHog flags. Read when the user asks to health-check flags.",
      ],
      [
        "TRIGGER when",
        "Investigate traces.\nTRIGGER when: user pastes a trace URL.",
      ],
      [
        "trigger when (lowercase)",
        "Investigate traces. ONLY trigger when the user pastes a trace URL.",
      ],
    ])(
      "does not flag a bundled skill with a %s guard",
      (_label, description) => {
        const skill = makeSkill({ source: "bundled", description });
        expect(analyzeSkills([skill])).toEqual({});
      },
    );

    it("does not flag a bundled skill with no ambiguous verbs", () => {
      const skill = makeSkill({
        source: "bundled",
        description: "Run an A/B test experiment in PostHog.",
      });

      expect(analyzeSkills([skill])).toEqual({});
    });

    it("reports the matched verbs in the message", () => {
      const skill = makeSkill({
        source: "bundled",
        description: "Debug and diagnose why the dashboard is slow.",
      });

      const [issue] = analyzeSkills([skill])[skill.path] ?? [];

      expect(issue?.message).toContain("debug");
      expect(issue?.message).toContain("diagnose");
    });

    it("hasAmbiguousTrigger returns false for a skill that is already guarded", () => {
      const skill = makeSkill({
        source: "bundled",
        description:
          "Investigate the issue.\nTRIGGER when: user says investigate.",
      });

      expect(hasAmbiguousTrigger(skill)).toBe(false);
    });

    it("AMBIGUOUS_TRIGGER_VERBS contains at least 5 verbs (sentinel)", () => {
      expect(AMBIGUOUS_TRIGGER_VERBS.length).toBeGreaterThanOrEqual(5);
    });

    it.each(["investigate", "debug", "diagnose"] as const)(
      "AMBIGUOUS_TRIGGER_VERBS includes the core coding-overlap verb %s",
      (verb) => {
        expect(AMBIGUOUS_TRIGGER_VERBS).toContain(verb);
      },
    );
  });

  it("accumulates multiple issues on one skill", () => {
    const skill = makeSkill({
      name: "Other Name",
      description: "",
      skillMdBytes: OVERSIZED_SKILL_MD_BYTES * 2,
    });

    const analysis = analyzeSkills([skill]);

    expect(analysis[skill.path]?.map((i) => i.type)).toEqual([
      "missing-description",
      "name-mismatch",
      "oversized-manifest",
    ]);
  });
});
