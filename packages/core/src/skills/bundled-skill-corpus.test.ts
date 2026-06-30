/**
 * Corpus quality tests for the bundled PostHog plugin skills.
 *
 * These run against the real skill files that ship with the app and assert
 * structural properties that prevent overfitting: being steered toward a
 * PostHog analytics skill when the user is doing unrelated coding work.
 *
 * Tests SKIP when the bundled skills directory doesn't exist (fresh checkout
 * before `pnpm build`). Once built, every failure names a skill that needs
 * a TRIGGER guard in its description.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { SkillInfo } from "@posthog/shared";
import { describe, expect, it } from "vitest";
import {
  AMBIGUOUS_TRIGGER_VERBS,
  analyzeSkills,
  hasAmbiguousTrigger,
} from "./analyzeSkills";

const BUNDLED_SKILLS_DIR = path.resolve(
  __dirname,
  "../../../../apps/code/.vite/build/plugins/posthog/skills",
);

function loadBundledSkills(): SkillInfo[] | null {
  if (!fs.existsSync(BUNDLED_SKILLS_DIR)) return null;
  const entries = fs.readdirSync(BUNDLED_SKILLS_DIR, { withFileTypes: true });
  const skills: SkillInfo[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const skillPath = path.join(BUNDLED_SKILLS_DIR, entry.name);
    const manifestPath = path.join(skillPath, "SKILL.md");
    if (!fs.existsSync(manifestPath)) continue;

    const content = fs.readFileSync(manifestPath, "utf-8");
    const nameMatch = content.match(/^name:\s*(.+)$/m);
    // Handles four YAML description forms:
    //   folded:  description: >\n  line\n  line
    //   double:  description: "text"
    //   single:  description: 'text'
    //   plain:   description: text on one line
    const foldedMatch = content.match(
      /^description:\s*>-?\s*\n((?:[ \t]+.+\n?)+)/m,
    );
    const quotedMatch = content.match(
      /^description:\s*(?:"([\s\S]+?)"|'([\s\S]+?)')\s*$/m,
    );
    const plainMatch = content.match(/^description:\s+([^>'"|\n].+)$/m);
    const rawDesc = foldedMatch
      ? foldedMatch[1]
          ?.split("\n")
          .map((l) => l.trim())
          .join(" ")
          .trim()
      : quotedMatch
        ? (quotedMatch[1] ?? quotedMatch[2] ?? "").trim()
        : (plainMatch?.[1] ?? "").trim();

    skills.push({
      name: nameMatch?.[1]?.trim() ?? entry.name,
      description: rawDesc,
      source: "bundled",
      path: skillPath,
      editable: false,
      skillMdBytes: Buffer.byteLength(content, "utf-8"),
    });
  }

  return skills.length > 0 ? skills : null;
}

const skills = loadBundledSkills();

describe.skipIf(skills === null)("bundled posthog skill corpus", () => {
  // TypeScript cannot narrow `skills` inside the callback even though
  // describe.skipIf guarantees the suite only runs when skills !== null.
  const corpus = skills as SkillInfo[];

  it("loads a non-trivial number of skills (sanity check)", () => {
    expect(corpus.length).toBeGreaterThan(50);
  });

  it("every skill has a non-empty description", () => {
    const missing = corpus.filter((s) => !s.description.trim());
    expect(missing.map((s) => s.name)).toEqual([]);
  });

  /**
   * Overfitting guard: every bundled skill whose description uses a
   * coding-overlap verb must have an explicit TRIGGER guard.
   *
   * Without a guard the model sees "investigate why a metric dropped" and
   * "investigate why a test is failing" as equally close to the same set
   * of skills — picking a PostHog analytics skill for coding work.
   *
   * Fix: add to the skill's description field —
   *   TRIGGER when: <specific PostHog scenario>
   *   DO NOT TRIGGER when: <coding / non-analytics scenario>
   */
  it("every ambiguous-verb skill has a TRIGGER guard in its description", () => {
    const violations = corpus.filter(hasAmbiguousTrigger);

    if (violations.length > 0) {
      const lines = violations.map((s) => {
        const matched = AMBIGUOUS_TRIGGER_VERBS.filter((v) =>
          s.description.toLowerCase().includes(v),
        );
        return `  ${s.name}  [${matched.join(", ")}]`;
      });
      console.error(
        `${violations.length} skill(s) need a TRIGGER guard:\n${lines.join("\n")}`,
      );
    }

    expect(violations.map((s) => s.name)).toEqual([]);
  });

  /**
   * Intent-collision guard: no action verb should appear in more than 8
   * *unguarded* descriptions. Skills that already have a Use-when or TRIGGER
   * guard are self-disambiguating — the model picks between them on domain
   * specifics. Unguarded skills sharing the same verb give the model no basis
   * to choose and cause false invocations in coding sessions.
   */
  it("no action verb dominates more than 8 unguarded skill descriptions", () => {
    const collisions: string[] = [];

    for (const word of AMBIGUOUS_TRIGGER_VERBS) {
      const unguarded = corpus.filter(
        (s) =>
          s.description.toLowerCase().includes(word) && hasAmbiguousTrigger(s),
      );
      if (unguarded.length > 8) {
        collisions.push(
          `"${word}" in ${unguarded.length} unguarded descriptions: ${unguarded.map((s) => s.name).join(", ")}`,
        );
      }
    }

    if (collisions.length > 0) {
      console.error(
        `Intent collisions:\n${collisions.map((c) => `  ${c}`).join("\n")}`,
      );
    }

    expect(collisions).toEqual([]);
  });

  it("analyzeSkills reports no issues on the full corpus", () => {
    const analysis = analyzeSkills(corpus);
    const allIssues = Object.entries(analysis).flatMap(([p, issues]) =>
      issues.map((issue) => ({
        skill: path.basename(p),
        type: issue.type,
        message: issue.message,
      })),
    );

    if (allIssues.length > 0) {
      console.error(
        "Corpus issues:\n" +
          allIssues
            .map((i) => `  [${i.type}] ${i.skill}: ${i.message}`)
            .join("\n"),
      );
    }

    expect(allIssues).toEqual([]);
  });
});
