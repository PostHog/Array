import { describe, expect, it } from "vitest";
import { BRANCH_PREFIX, normalizeBranchPrefix } from "./git-naming";

describe("normalizeBranchPrefix", () => {
  it("falls back to the default for empty input", () => {
    expect(normalizeBranchPrefix("")).toBe(BRANCH_PREFIX);
    expect(normalizeBranchPrefix("   ")).toBe(BRANCH_PREFIX);
    expect(normalizeBranchPrefix(undefined)).toBe(BRANCH_PREFIX);
    expect(normalizeBranchPrefix(null)).toBe(BRANCH_PREFIX);
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeBranchPrefix("  team/  ")).toBe("team/");
  });

  it("guarantees exactly one trailing slash", () => {
    expect(normalizeBranchPrefix("team")).toBe("team/");
    expect(normalizeBranchPrefix("team/")).toBe("team/");
    expect(normalizeBranchPrefix("team//")).toBe("team/");
    expect(normalizeBranchPrefix("team-")).toBe("team-/");
  });

  it("strips leading slashes and collapses repeated slashes", () => {
    expect(normalizeBranchPrefix("/team/")).toBe("team/");
    expect(normalizeBranchPrefix("team//sub/")).toBe("team/sub/");
  });

  it("falls back to the default when only slashes are provided", () => {
    expect(normalizeBranchPrefix("/")).toBe(BRANCH_PREFIX);
  });
});
