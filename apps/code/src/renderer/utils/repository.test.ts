import { describe, expect, it } from "vitest";
import {
  findMatchingRepository,
  normalizeRepositoryLookupKey,
} from "./repository";

describe("normalizeRepositoryLookupKey", () => {
  it("lowercases and strips a .git suffix", () => {
    expect(normalizeRepositoryLookupKey(" PostHog/Code.git\n")).toBe(
      "posthog/code",
    );
  });
});

describe("findMatchingRepository", () => {
  it("matches repositories case-insensitively", () => {
    expect(findMatchingRepository("posthog/code", ["PostHog/Code"])).toBe(
      "PostHog/Code",
    );
  });

  it("matches repositories even when the input has a .git suffix", () => {
    expect(findMatchingRepository("posthog/code.git", ["PostHog/Code"])).toBe(
      "PostHog/Code",
    );
  });

  it("returns null when there is no matching repository", () => {
    expect(findMatchingRepository("posthog/code", ["posthog/posthog"])).toBe(
      null,
    );
  });
});
