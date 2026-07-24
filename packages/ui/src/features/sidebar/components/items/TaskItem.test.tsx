import type { TaskLabel } from "@posthog/shared";
import { Theme } from "@radix-ui/themes";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TaskItem } from "./TaskItem";

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

function renderItem(taskLabel: TaskLabel | null) {
  return render(
    <Theme>
      <TaskItem
        taskId="t1"
        label="My task"
        isActive={false}
        taskLabel={taskLabel}
        onClick={() => {}}
        onContextMenu={() => {}}
      />
    </Theme>,
  );
}

describe("TaskItem label dot", () => {
  it("shows a dot named after the label when the task is labeled", () => {
    renderItem("high-priority");
    expect(
      screen.getByRole("img", { name: "Label: High priority" }),
    ).toBeInTheDocument();
  });

  it("renders nothing label-related when the task is unlabeled", () => {
    renderItem(null);
    expect(
      screen.queryByRole("img", { name: /^Label:/ }),
    ).not.toBeInTheDocument();
  });
});
