import type { Task, TaskRun } from "@posthog/shared/domain-types";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runs: [] as TaskRun[],
}));

vi.mock("@posthog/ui/features/canvas/hooks/useTaskRuns", () => ({
  useTaskRuns: () => ({ runs: mocks.runs, isLoading: false }),
}));
vi.mock("@posthog/ui/features/git-interaction/usePrArtifact", () => ({
  usePrArtifact: (url: string) => ({
    safeUrl: url,
    title: `Pull request #${url.split("/").at(-1)}`,
    stateLabel: "Open",
    Icon: () => <span />,
    iconColor: "currentColor",
  }),
}));
vi.mock("@posthog/ui/features/pr-review/usePrComments", () => ({
  usePrComments: () => ({ data: undefined }),
}));
vi.mock("@posthog/ui/features/pr-review/usePrReviewThreads", () => ({
  usePrReviewThreads: () => ({ data: undefined }),
}));

import { useReviewNavigationStore } from "@posthog/ui/features/code-review/reviewNavigationStore";
import { TaskArtifactsList } from "./TaskArtifactsList";

const task = {
  id: "task-1",
  latest_run: null,
} as unknown as Task;

function run(id: string, prNumber: number): TaskRun {
  return {
    id,
    output: { pr_url: `https://github.com/acme/repo/pull/${prNumber}` },
  } as unknown as TaskRun;
}

describe("TaskArtifactsList", () => {
  beforeEach(() => {
    mocks.runs = [run("run-1", 1), run("run-2", 2)];
    useReviewNavigationStore.setState({
      reviewModes: {},
      selectedPrUrls: {},
    });
  });

  it("opens the PR represented by the selected historical row", () => {
    render(<TaskArtifactsList task={task} timeline={[]} />);

    fireEvent.click(screen.getByText("Pull request #2"));

    const state = useReviewNavigationStore.getState();
    expect(state.selectedPrUrls[task.id]).toBe(
      "https://github.com/acme/repo/pull/2",
    );
    expect(state.reviewModes[task.id]).toBe("split");
  });
});
