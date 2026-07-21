import { describe, expect, it } from "vitest";
import { avatarColorClass } from "./avatarColor";

describe("avatarColorClass", () => {
  it("is deterministic for a given seed", () => {
    expect(avatarColorClass("user-uuid-123")).toBe(
      avatarColorClass("user-uuid-123"),
    );
  });

  it("always returns a white-text palette class", () => {
    for (const seed of ["a", "raquel@posthog.com", "uuid", "", "James Doe"]) {
      expect(avatarColorClass(seed)).toMatch(/^bg-\(--[a-z]+-9\) text-white$/);
    }
  });

  it("spreads distinct seeds across more than one hue", () => {
    const seeds = Array.from({ length: 40 }, (_, i) => `person-${i}`);
    const distinct = new Set(seeds.map(avatarColorClass));
    expect(distinct.size).toBeGreaterThan(1);
  });
});
