import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import type { Task } from "../types";
import { TaskItem } from "./TaskItem";

vi.mock("phosphor-react-native", () => ({
  Check: (props: Record<string, unknown>) => createElement("Check", props),
  GitPullRequest: (props: Record<string, unknown>) =>
    createElement("GitPullRequest", props),
}));

vi.mock("@/lib/theme", () => ({
  useThemeColors: () => ({
    gray: { 11: "#444444" },
    accent: { 9: "#ff5500" },
  }),
}));

vi.mock("@components/text", () => ({
  Text: (props: Record<string, unknown>) => createElement("Text", props),
}));

vi.mock("./TaskStatusIcon", () => ({
  TaskStatusIcon: (props: Record<string, unknown>) =>
    createElement("TaskStatusIcon", props),
}));

function makeTask(prUrl?: string): Task {
  return {
    id: "task-1",
    task_number: 1,
    slug: "task-1",
    title: "Test task",
    description: "",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    origin_product: "code",
    latest_run: prUrl
      ? {
          id: "run-1",
          task: "task-1",
          team: 1,
          branch: null,
          stage: null,
          environment: "cloud",
          status: "completed",
          log_url: "",
          error_message: null,
          output: { pr_url: prUrl },
          state: {},
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
          completed_at: null,
        }
      : undefined,
  };
}

function render(task: Task) {
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(createElement(TaskItem, { task, onPress: () => {} }));
  });
  return renderer;
}

describe("TaskItem", () => {
  function prIcons(renderer: ReturnType<typeof create>) {
    return renderer.root.findAll(
      (node) => String(node.type) === "GitPullRequest",
    );
  }

  it("shows the PR badge with the parsed number when a PR url is present", () => {
    const renderer = render(
      makeTask("https://github.com/PostHog/code/pull/2422"),
    );

    expect(prIcons(renderer)).toHaveLength(1);
    const number = renderer.root.findAll(
      (node) => String(node.type) === "Text" && node.props.children === "#2422",
    );
    expect(number).toHaveLength(1);
  });

  it("does not show the PR badge when there is no PR url", () => {
    expect(prIcons(render(makeTask()))).toHaveLength(0);
  });
});
