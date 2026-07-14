import type { FileDiffMetadata } from "@pierre/diffs";
import type { ChangedFile } from "@posthog/shared/domain-types";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../primitives/FileIcon", () => ({
  FileIcon: () => <span data-testid="file-icon" />,
}));

vi.mock("./InteractiveFileDiff", () => ({
  InteractiveFileDiff: ({
    fileDiff,
    renderCustomHeader,
  }: {
    fileDiff: FileDiffMetadata;
    renderCustomHeader: (fileDiff: FileDiffMetadata) => ReactNode;
  }) => renderCustomHeader(fileDiff),
}));

import { PatchedFileDiff } from "./PatchedFileDiff";

const patch = `diff --git a/src/reviewed.ts b/src/reviewed.ts
index 1111111..2222222 100644
--- a/src/reviewed.ts
+++ b/src/reviewed.ts
@@ -1 +1 @@
-before
+after`;

describe.each([
  ["regular", { path: "src/reviewed.ts", patch }],
  ["binary", { path: "assets/reviewed.png", patch: null }],
  ["unavailable", { path: "src/unavailable.ts", patch: null }],
] as const)("PatchedFileDiff %s header", (_kind, fileInput) => {
  it("renders metadata before line change stats", () => {
    const file = {
      ...fileInput,
      linesAdded: 2,
      linesRemoved: 1,
    } as ChangedFile;

    render(
      <PatchedFileDiff
        file={file}
        taskId="task"
        options={{}}
        collapsed
        onToggle={() => {}}
        headerMetadata={<span>2 comments</span>}
      />,
    );

    const header = screen.getByRole("button");
    const text = header.textContent ?? "";
    const additions = _kind === "regular" ? "+1" : "+2";

    expect(screen.getByText("2 comments")).toBeInTheDocument();
    expect(text.indexOf("2 comments")).toBeLessThan(text.indexOf(additions));
  });
});
