import { describe, expect, it } from "vitest";
import { getTaskRepository, parseRepository } from "./repository";

describe("getTaskRepository", () => {
  it.each([
    { name: "undefined task", task: undefined, expected: null },
    { name: "null task", task: null, expected: null },
    { name: "missing repository", task: {}, expected: null },
    { name: "null repository", task: { repository: null }, expected: null },
    {
      name: "populated repository",
      task: { repository: "posthog/code" },
      expected: "posthog/code",
    },
  ])("returns $expected for $name", ({ task, expected }) => {
    expect(getTaskRepository(task)).toBe(expected);
  });
});

describe("parseRepository", () => {
  it("splits an org/repo string", () => {
    expect(parseRepository("posthog/code")).toEqual({
      organization: "posthog",
      repoName: "code",
    });
  });

  it("returns null for malformed input", () => {
    expect(parseRepository("code")).toBeNull();
    expect(parseRepository("a/b/c")).toBeNull();
  });
});
