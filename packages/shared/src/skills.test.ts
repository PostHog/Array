import { describe, expect, it } from "vitest";
import type { SkillInfo } from "./skills";
import { getApplicableAlwaysOnSkills } from "./skills";

const globalSkill: SkillInfo = {
  name: "global",
  description: "",
  source: "user",
  path: "/home/user/.claude/skills/global",
  editable: true,
  skillMdBytes: 10,
};

const repoSkill: SkillInfo = {
  name: "repo",
  description: "",
  source: "repo",
  path: "/repos/code/.claude/skills/repo",
  repoName: "code",
  repoPath: "/repos/code",
  repository: "PostHog/code",
  editable: true,
  skillMdBytes: 10,
};

const preferences = [globalSkill, repoSkill].map(
  ({ name, source, path, repoPath, repository }) => ({
    name,
    source,
    path,
    repoPath,
    repository,
  }),
);

describe("getApplicableAlwaysOnSkills", () => {
  it("applies repo skills only to their local or cloud repository", () => {
    expect(
      getApplicableAlwaysOnSkills(preferences, [globalSkill, repoSkill], {
        repoPath: "/repos/code",
      }).applicable,
    ).toEqual(preferences);
    expect(
      getApplicableAlwaysOnSkills(preferences, [globalSkill, repoSkill], {
        repository: "posthog/code",
      }).applicable,
    ).toEqual(preferences);
    expect(
      getApplicableAlwaysOnSkills(preferences, [globalSkill, repoSkill], {})
        .applicable,
    ).toEqual([preferences[0]]);
  });

  it("reports missing applicable skills without treating other repo skills as unavailable", () => {
    const result = getApplicableAlwaysOnSkills(preferences, [], {
      repoPath: "/repos/other",
    });
    expect(result.applicable).toEqual([]);
    expect(result.unavailable).toEqual([preferences[0]]);
  });

  it("honors per-task exclusions", () => {
    const result = getApplicableAlwaysOnSkills(
      preferences,
      [globalSkill, repoSkill],
      { repoPath: "/repos/code" },
      new Set([`user:${globalSkill.path}`]),
    );
    expect(result.applicable).toEqual([preferences[1]]);
  });

  it("does not drop applicable skills while discovery is loading", () => {
    expect(
      getApplicableAlwaysOnSkills(preferences, undefined, {
        repository: "posthog/code",
      }).applicable,
    ).toEqual(preferences);
  });
});
