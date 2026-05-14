import { describe, expect, it } from "vitest";
import { ADJECTIVES, generateReadableName, NOUNS } from "./worktree-names";

describe("generateReadableName", () => {
  it("returns a string in adjective-noun format", () => {
    const name = generateReadableName();
    expect(name).toMatch(/^[a-z]+-[a-z]+$/);
  });

  it("draws the adjective from the ADJECTIVES list", () => {
    const [adjective] = generateReadableName().split("-");
    expect(ADJECTIVES).toContain(adjective);
  });

  it("draws the noun from the NOUNS list", () => {
    const [, noun] = generateReadableName().split("-");
    expect(NOUNS).toContain(noun);
  });

  it("produces valid names across many runs", () => {
    for (let i = 0; i < 250; i++) {
      const name = generateReadableName();
      const [adjective, noun, ...rest] = name.split("-");
      expect(rest).toEqual([]);
      expect(ADJECTIVES).toContain(adjective);
      expect(NOUNS).toContain(noun);
    }
  });
});

describe("worktree name word lists", () => {
  it("exceeds the previous 9_000 numeric namespace", () => {
    expect(ADJECTIVES.length * NOUNS.length).toBeGreaterThanOrEqual(10_000);
  });

  it.each([
    ["adjectives", ADJECTIVES],
    ["nouns", NOUNS],
  ] as const)("%s contain no duplicates", (_label, list) => {
    expect(new Set(list).size).toBe(list.length);
  });

  it("has no overlap between adjectives and nouns", () => {
    const nounSet = new Set<string>(NOUNS);
    const overlap = ADJECTIVES.filter((adjective) => nounSet.has(adjective));
    expect(overlap).toEqual([]);
  });

  it.each([
    ["adjectives", ADJECTIVES],
    ["nouns", NOUNS],
  ] as const)("%s contain only lowercase ASCII letters", (_label, list) => {
    for (const word of list) {
      expect(word).toMatch(/^[a-z]+$/);
    }
  });
});
