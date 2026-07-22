import type { Task } from "@posthog/shared/domain-types";
import { Theme } from "@radix-ui/themes";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskFeedRow } from "./ChannelFeedView";

const task = {
  id: "task-1",
  task_number: 1,
  slug: "task-1",
  title: "Investigate signup drop-off",
  description: "A long prompt that needs to be expanded in the channel feed",
  created_at: "2026-07-17T12:00:00.000Z",
  updated_at: "2026-07-17T12:00:00.000Z",
  origin_product: "user_created",
  created_by: {
    id: 1,
    uuid: "user-1",
    email: "person@example.com",
    first_name: "A",
    last_name: "Person",
  },
} satisfies Task;

describe("TaskFeedRow", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("expands a truncated prompt", async () => {
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(
      function (this: HTMLElement) {
        return (this.textContent?.length ?? 0) > 35 ? 60 : 20;
      },
    );
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(40);
    const user = userEvent.setup();
    const { container } = render(
      <Theme>
        <TaskFeedRow task={task} />
      </Theme>,
    );

    const prompt = container.querySelector(
      '[data-slot="thread-item-body"]:not([aria-hidden])',
    );
    const more = screen.getByRole("button", { name: "more" });
    expect(prompt).toHaveTextContent(/\.\.\. more$/);
    expect(prompt).toContainElement(more);

    await user.click(more);

    expect(prompt).toHaveTextContent(task.description);
    expect(screen.getByRole("button", { name: "less" })).toBeInTheDocument();
  });

  it("collapses newlines and whitespace before truncating", () => {
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(
      function (this: HTMLElement) {
        return (this.textContent?.length ?? 0) > 35 ? 60 : 20;
      },
    );
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(40);
    const multilineTask = {
      ...task,
      description:
        "truncation was recently added to message prompts, but\n\nthere is more text after it",
    };

    const { container } = render(
      <Theme>
        <TaskFeedRow task={multilineTask} />
      </Theme>,
    );

    const prompt = container.querySelector(
      '[data-slot="thread-item-body"]:not([aria-hidden])',
    );
    expect(prompt?.textContent).not.toContain("\n");
    expect(prompt).toHaveTextContent(/[^ ]\.\.\. more$/);
  });
});
