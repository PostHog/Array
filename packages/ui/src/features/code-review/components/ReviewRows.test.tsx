import type { PrCommentThread } from "@posthog/core/code-review/types";
import type { ChangedFile } from "@posthog/shared/domain-types";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./PatchedFileDiff", () => ({
  PatchedFileDiff: ({ headerMetadata }: { headerMetadata?: ReactNode }) => (
    <div>{headerMetadata}</div>
  ),
}));

import { RemoteRow } from "./ReviewRows";

const file = {
  path: "src/reviewed.ts",
  patch: "",
  linesAdded: 1,
  linesRemoved: 0,
} as ChangedFile;

const commentThreads = new Map<number, PrCommentThread>([
  [
    1,
    {
      rootId: 1,
      nodeId: "thread-1",
      isResolved: false,
      filePath: file.path,
      comments: [{ id: 1 }, { id: 2 }] as PrCommentThread["comments"],
    },
  ],
]);

describe("RemoteRow", () => {
  it("shows the comment count for a collapsed PR file", () => {
    render(
      <RemoteRow
        file={file}
        taskId="task"
        prUrl="https://github.com/PostHog/posthog/pull/1"
        options={{}}
        collapsed
        toggleFile={() => {}}
        commentThreads={commentThreads}
      />,
    );

    expect(screen.getByTitle("2 comments")).toBeInTheDocument();
  });

  it("shows the comment count when the file is expanded", () => {
    render(
      <RemoteRow
        file={file}
        taskId="task"
        prUrl="https://github.com/PostHog/posthog/pull/1"
        options={{}}
        collapsed={false}
        toggleFile={() => {}}
        commentThreads={commentThreads}
      />,
    );

    expect(screen.getByTitle("2 comments")).toBeInTheDocument();
  });
});
