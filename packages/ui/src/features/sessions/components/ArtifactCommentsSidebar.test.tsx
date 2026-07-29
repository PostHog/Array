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
        members={[]}
        currentVersion="artifact-1"
        selectedThreadId={null}
        pulseThreadId={null}
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
    const composer = container.querySelector("footer .mention-composer");
    if (!thread || !composer) throw new Error("Expected thread and composer");
    expect(thread.compareDocumentPosition(composer)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("derives resolved state from PAT-compatible thread events", () => {
    const stateEvent: ArtifactComment = {
      ...comment,
      id: "state-1",
      content: "Resolved this thread",
      source_comment: comment.id,
      item_context: {
        ...(comment.item_context as Record<string, unknown>),
        threadState: "resolved",
      },
    };
    render(
      <ArtifactCommentsSidebar
        comments={[comment, stateEvent]}
        members={[]}
        currentVersion="artifact-1"
        selectedThreadId={null}
        pulseThreadId={null}
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

    fireEvent.click(screen.getByRole("button", { name: "Filter comments" }));
    fireEvent.click(
      screen.getByRole("menuitemradio", { name: "Resolved (1)" }),
    );
    expect(screen.getByRole("button", { name: "Reopen" })).toBeTruthy();
    expect(screen.queryByText("Resolved this thread")).toBeNull();
  });

  it("pulses a thread selected from highlighted artifact content", () => {
    const { container } = render(
      <ArtifactCommentsSidebar
        comments={[comment]}
        members={[]}
        currentVersion="artifact-1"
        selectedThreadId="comment-1"
        pulseThreadId="comment-1"
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

    expect(
      container.querySelector('[data-comment-thread-id="comment-1"]'),
    ).toHaveClass("ring-2", "ring-accent");
  });

  it("selects a thread when its comment body is clicked", () => {
    const onSelectThread = vi.fn();
    render(
      <ArtifactCommentsSidebar
        comments={[comment]}
        members={[]}
        currentVersion="artifact-1"
        selectedThreadId={null}
        pulseThreadId={null}
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
