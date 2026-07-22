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

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TaskFeedRow", () => {
  it("expands a truncated prompt", async () => {
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(60);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(40);
    const user = userEvent.setup();
    const { container } = render(
      <Theme>
        <TaskFeedRow task={task} />
      </Theme>,
    );

    const prompt = container.querySelector(
      "[data-slot=thread-item-body]",
    ) as HTMLElement;
    expect(prompt).toHaveClass("line-clamp-2");
    const more = screen.getByRole("button", { name: "more" });
    // The toggle lives inside the clamped prompt, beside the ellipsis — not as a
    // sibling pushed onto its own line.
    expect(prompt).toContainElement(more);

    await user.click(more);

    expect(prompt).not.toHaveClass("line-clamp-2");
    expect(screen.getByRole("button", { name: "less" })).toBeInTheDocument();
  });

  it("renders no toggle when the prompt fits", () => {
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(20);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(40);
    render(
      <Theme>
        <TaskFeedRow task={task} />
      </Theme>,
    );

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
