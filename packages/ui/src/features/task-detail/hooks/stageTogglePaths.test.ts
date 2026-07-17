import type { ChangedFile } from "@posthog/shared/domain-types";
import { describe, expect, it } from "vitest";
import { getStageTogglePaths } from "./stageTogglePaths";

describe("getStageTogglePaths", () => {
  it.each([
    {
      name: "uses the current path for a regular file",
      file: { path: "current.ts", status: "modified" } satisfies ChangedFile,
      expected: ["current.ts"],
    },
    {
      name: "uses both paths for a renamed file",
      file: {
        path: "new.ts",
        originalPath: "old.ts",
        status: "renamed",
      } satisfies ChangedFile,
      expected: ["old.ts", "new.ts"],
    },
  ])("$name", ({ file, expected }) => {
    expect(getStageTogglePaths(file)).toEqual(expected);
  });
});
