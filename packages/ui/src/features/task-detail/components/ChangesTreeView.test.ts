import type { ChangedFile } from "@posthog/shared/domain-types";
import { describe, expect, it } from "vitest";
import {
  classifyChangedFile,
  type FileTypeCategory,
  groupChangesByFileType,
} from "./changesTree";

const changedFile = (path: string): ChangedFile => ({
  path,
  status: "modified",
});

describe("classifyChangedFile", () => {
  it.each<[string, FileTypeCategory]>([
    ["packages/core/src/service.ts", "Implementation"],
    ["packages/core/src/service.test.ts", "Tests"],
    ["tests/e2e/review.spec.ts", "Tests"],
    ["packages/core/service_test.go", "Tests"],
    ["packages/core/test_service.py", "Tests"],
    ["packages/api/src/__generated__/schema.ts", "Generated"],
    ["packages/api/src/schema.generated.ts", "Generated"],
    ["packages/api/src/messages.pb.go", "Generated"],
    ["pnpm-lock.yaml", "Generated"],
    ["docs/code-review.md", "Documentation"],
    ["README.md", "Documentation"],
    [".github/workflows/ci.yml", "Configuration"],
    ["package.json", "Configuration"],
    ["requirements.txt", "Configuration"],
    ["packages/ui/src/assets/review.png", "Assets"],
    ["Makefile", "Other"],
  ])("classifies %s as %s", (path, expected) => {
    expect(classifyChangedFile(path)).toBe(expected);
  });
});

describe("groupChangesByFileType", () => {
  it("orders categories and files consistently", () => {
    const groups = groupChangesByFileType([
      changedFile("docs/z-last.md"),
      changedFile("src/z-last.ts"),
      changedFile("src/a-first.ts"),
      changedFile("src/service.test.ts"),
      changedFile("src/schema.generated.ts"),
      changedFile("package.json"),
    ]);

    expect(groups.map((group) => group.category)).toEqual([
      "Implementation",
      "Tests",
      "Generated",
      "Documentation",
      "Configuration",
    ]);
    expect(groups[0]?.files.map((file) => file.path)).toEqual([
      "src/a-first.ts",
      "src/z-last.ts",
    ]);
  });
});
