import type { ResourceComment } from "@posthog/api-client/posthog-client";
import type { Task, TaskRun, TaskRunArtifact } from "@posthog/shared";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runs: [] as TaskRun[],
  comments: [] as unknown[],
  openArtifactTab: vi.fn(),
  createComment: vi.fn(),
  setResolved: vi.fn(),
  createdFor: [] as unknown[],
  resolvedFor: [] as unknown[],
}));

vi.mock("@posthog/ui/features/canvas/hooks/useTaskRuns", () => ({
  useTaskRuns: () => ({ runs: mocks.runs, isLoading: false }),
}));
vi.mock("@posthog/ui/features/canvas/hooks/useOrgMembers", () => ({
  useOrgMembers: () => ({ members: [] }),
}));
vi.mock("@posthog/ui/features/panels/panelLayoutStore", () => ({
  usePanelLayoutStore: () => mocks.openArtifactTab,
}));
vi.mock("@posthog/ui/features/sessions/components/useComments", () => ({
  useCommentsForTargetsQuery: () => ({
    data: mocks.comments,
    isLoading: false,
  }),
  useCreateComment: (target: unknown) => {
    mocks.createdFor.push(target);
    return { mutate: mocks.createComment, isPending: false };
  },
  useSetCommentResolved: (target: unknown) => {
    mocks.resolvedFor.push(target);
    return { mutate: mocks.setResolved, isPending: false };
  },
}));

import { useCommentNavigationStore } from "@posthog/ui/features/sessions/commentNavigationStore";
import { TaskCommentsList } from "./TaskCommentsList";

const task = { id: "task-1", latest_run: null } as unknown as Task;

function run(artifacts: Partial<TaskRunArtifact>[], id = "run-1"): TaskRun {
  return { id, output: null, artifacts } as unknown as TaskRun;
}

function outputFile(
  overrides: Partial<TaskRunArtifact>,
): Partial<TaskRunArtifact> {
  return {
    type: "output",
    name: "report.md",
    storage_path: "runs/1/report.md",
    ...overrides,
  };
}

function comment(overrides: Partial<ResourceComment>): ResourceComment {
  return {
    id: "comment-1",
    created_by: null,
    content: "Tighten this summary",
    created_at: "2024-01-01T00:00:00Z",
    item_id: "a",
    item_context: { anchor: { kind: "document" } },
    scope: "task_artifact",
    source_comment: null,
    ...overrides,
  } as ResourceComment;
}

describe("TaskCommentsList", () => {
  beforeEach(() => {
    mocks.runs = [
      run([
        outputFile({ id: "a", name: "report.md" }),
        outputFile({
          id: "b",
          name: "summary.md",
          storage_path: "runs/1/summary.md",
        }),
      ]),
    ];
    mocks.comments = [
      comment({}),
      comment({
        id: "reply-1",
        source_comment: "comment-1",
        content: "Agreed",
        created_at: "2024-01-01T00:01:00Z",
      }),
      comment({
        id: "comment-2",
        item_id: "b",
        content: "Second thread",
        created_at: "2024-01-01T00:02:00Z",
      }),
    ];
    mocks.openArtifactTab.mockReset();
    mocks.createComment.mockReset();
    mocks.setResolved.mockReset();
    mocks.createdFor = [];
    mocks.resolvedFor = [];
    useCommentNavigationStore.setState({
      focusByTask: {},
      resolutionsByTarget: {},
    });
  });

  // The tab is the one place to see every thread the task produced, so each row
  // has to say which artifact it came from.
  it("lists open threads from every artifact, newest first", () => {
    render(<TaskCommentsList task={task} timeline={[]} />);

    const newest = screen.getByText("Second thread");
    const oldest = screen.getByText("Tighten this summary");
    expect(
      newest.compareDocumentPosition(oldest) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByText("summary.md")).toBeTruthy();
    expect(screen.getByText("report.md")).toBeTruthy();
    expect(screen.getByText(/1 reply/)).toBeTruthy();
    // The resolve/reopen reply is thread state, not a comment of its own.
    expect(screen.queryByText("Agreed")).toBeTruthy();
  });

  it("opens the artifact a thread belongs to and focuses that thread", () => {
    render(<TaskCommentsList task={task} timeline={[]} />);

    fireEvent.click(screen.getByText("Tighten this summary"));

    expect(mocks.openArtifactTab).toHaveBeenCalledWith("task-1", {
      runId: "run-1",
      artifactId: "a",
      name: "report.md",
    });
    expect(useCommentNavigationStore.getState().focusByTask["task-1"]).toEqual({
      target: { scope: "task_artifact", itemId: "a" },
      threadId: "comment-1",
      nonce: expect.any(Number),
    });
  });

  // Clicking the same thread twice has to scroll twice, so every request is a
  // new nonce rather than a no-op set.
  it("re-requests focus for a thread already focused", () => {
    render(<TaskCommentsList task={task} timeline={[]} />);

    fireEvent.click(screen.getByText("Tighten this summary"));
    const first = useCommentNavigationStore.getState().focusByTask["task-1"];
    fireEvent.click(screen.getByText("Tighten this summary"));
    const second = useCommentNavigationStore.getState().focusByTask["task-1"];

    expect(second?.nonce).toBeGreaterThan(first?.nonce ?? 0);
  });

  it("filters between open and resolved threads", () => {
    mocks.comments = [
      comment({}),
      comment({
        id: "state-1",
        source_comment: "comment-1",
        content: "Resolved this thread",
        created_at: "2024-01-01T00:03:00Z",
        item_context: {
          anchor: { kind: "document" },
          threadState: "resolved",
        },
      }),
      comment({
        id: "comment-2",
        item_id: "b",
        content: "Second thread",
        created_at: "2024-01-01T00:02:00Z",
      }),
    ];

    render(<TaskCommentsList task={task} timeline={[]} />);

    expect(screen.getByText("Second thread")).toBeTruthy();
    expect(screen.queryByText("Tighten this summary")).toBeNull();

    fireEvent.click(screen.getByLabelText("Filter comments"));
    fireEvent.click(screen.getByText("Resolved (1)"));

    expect(screen.getByText("Tighten this summary")).toBeTruthy();
    expect(screen.queryByText("Second thread")).toBeNull();
  });

  it("warns when the anchored text the thread points at has changed", () => {
    useCommentNavigationStore.setState({
      resolutionsByTarget: {
        "task_artifact:a": new Map([["comment-1", "orphaned" as const]]),
      },
    });

    render(<TaskCommentsList task={task} timeline={[]} />);

    expect(screen.getByText("The highlighted text changed")).toBeTruthy();
  });

  it("replies and resolves against the thread's own resource", () => {
    render(<TaskCommentsList task={task} timeline={[]} />);

    // Each row builds its mutations from its own target, since the list spans
    // several resources.
    expect(mocks.createdFor).toContainEqual({
      scope: "task_artifact",
      itemId: "a",
    });
    expect(mocks.resolvedFor).toContainEqual({
      scope: "task_artifact",
      itemId: "b",
    });

    const thread = screen
      .getByText("Tighten this summary")
      .closest("[data-comment-thread-id]") as HTMLElement;
    fireEvent.click(within(thread).getByText("Resolve"));

    expect(mocks.setResolved).toHaveBeenCalledWith({
      root: expect.objectContaining({ id: "comment-1" }),
      resolved: true,
    });
  });

  it("shows an empty state pointing at the artifact surfaces", () => {
    mocks.comments = [];

    render(<TaskCommentsList task={task} timeline={[]} />);

    expect(screen.getByText("No open comments")).toBeTruthy();
  });
});
