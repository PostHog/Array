import { describe, expect, it } from "vitest";
import { generateHumanReadableName } from "./worktree-name";

describe("generateHumanReadableName", () => {
  it("returns a string matching adjective-noun-NN", () => {
    const name = generateHumanReadableName();
    expect(name).toMatch(/^[a-z]+-[a-z]+-\d{2}$/);
  });

  it("produces varied names over multiple calls", () => {
    const names = new Set<string>();
    for (let i = 0; i < 50; i++) {
      names.add(generateHumanReadableName());
    }
    // With 36 * 36 * 90 = ~116k combinations, 50 draws should yield
    // many unique values. Allow generous slack for randomness.
    expect(names.size).toBeGreaterThan(20);
  });

  it("uses only filesystem-safe characters", () => {
    for (let i = 0; i < 25; i++) {
      const name = generateHumanReadableName();
      expect(name).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("stays compact (under 32 chars)", () => {
    for (let i = 0; i < 25; i++) {
      expect(generateHumanReadableName().length).toBeLessThanOrEqual(32);
    }
  });
});
