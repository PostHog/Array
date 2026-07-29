import type { ArtifactComment } from "@posthog/api-client/posthog-client";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ArtifactCommentsSidebar } from "./ArtifactCommentsSidebar";

const comment: ArtifactComment = {
  id: "comment-1",
  created_by: {
    id: 1,
    uuid: "user-1",
    first_name: "Hedge",
    email: "hedge@example.com",
  },
  content: "Review this paragraph",
  created_at: new Date().toISOString(),
  item_id: "artifact-1",
  item_context: {
    taskId: "task-1",
    runId: "run-1",
    artifactId: "artifact-1",
    artifactVersion: "artifact-1",
    anchor: {
      kind: "text",
      quote: "paragraph",
      prefix: "this ",
      suffix: "",
      start: 12,
      end: 21,
    },
  },
  scope: "task_artifact",
  source_comment: null,
  is_task: true,
  completed_at: null,
};

describe("ArtifactCommentsSidebar", () => {
  it("keeps the new-comment composer below the thread list", () => {
    const { container } = render(
      <ArtifactCommentsSidebar
        comments={[comment]}
        currentVersion="artifact-1"
        selectedThreadId={null}
        resolutions={new Map()}
        loading={false}
        busy={false}
        onClose={vi.fn()}
        onSelectThread={vi.fn()}
        onCreateDocumentComment={vi.fn()}
        onReply={vi.fn()}
        onResolve={vi.fn()}
      />,
    );

    const thread = container.querySelector(
      '[data-comment-thread-id="comment-1"]',
    );
    const composer = screen.getByPlaceholderText("Comment on this artifact...");
    expect(thread).not.toBeNull();
    expect(thread?.compareDocumentPosition(composer) ?? 0).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("selects a thread when its comment body is clicked", () => {
    const onSelectThread = vi.fn();
    render(
      <ArtifactCommentsSidebar
        comments={[comment]}
        currentVersion="artifact-1"
        selectedThreadId={null}
        resolutions={new Map()}
        loading={false}
        busy={false}
        onClose={vi.fn()}
        onSelectThread={onSelectThread}
        onCreateDocumentComment={vi.fn()}
        onReply={vi.fn()}
        onResolve={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText("Review this paragraph"));
    expect(onSelectThread).toHaveBeenCalledWith("comment-1");
  });
});
