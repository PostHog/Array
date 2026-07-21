import { describe, expect, it } from "vitest";
import { avatarColorVar } from "./avatarColor";

describe("avatarColorVar", () => {
  it("is deterministic for a given seed", () => {
    expect(avatarColorVar("user-uuid-123")).toBe(
      avatarColorVar("user-uuid-123"),
    );
  });

  it("returns a Radix color-scale CSS variable reference", () => {
    for (const seed of ["a", "raquel@posthog.com", "uuid", "", "James Doe"]) {
      expect(avatarColorVar(seed)).toMatch(/^var\(--[a-z]+-9\)$/);
    }
  });

  it("spreads distinct seeds across more than one color", () => {
    const seeds = Array.from({ length: 40 }, (_, i) => `person-${i}`);
    const distinct = new Set(seeds.map(avatarColorVar));
    expect(distinct.size).toBeGreaterThan(1);
  });
});
