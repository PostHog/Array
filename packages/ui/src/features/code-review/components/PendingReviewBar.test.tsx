import { Theme } from "@radix-ui/themes";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useReviewDraftsStore } from "../reviewDraftsStore";
import { PendingReviewBar } from "./PendingReviewBar";

const { sendPromptToAgent } = vi.hoisted(() => ({
  sendPromptToAgent: vi.fn(),
}));

vi.mock("../../sessions/sendPromptToAgent", () => ({ sendPromptToAgent }));

describe("PendingReviewBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useReviewDraftsStore.setState({
      drafts: {
        "task-1": [
          {
            id: "draft-1",
            taskId: "task-1",
            filePath: "src/example.ts",
            startLine: 8,
            endLine: 10,
            side: "additions",
            text: "Use the shared helper",
            createdAt: 1,
          },
        ],
      },
      batchEnabled: { "task-1": true },
    });
  });

  it("keeps expanded review open when sending batched comments", async () => {
    const user = userEvent.setup();

    render(
      <Theme>
        <PendingReviewBar taskId="task-1" />
      </Theme>,
    );

    await user.click(screen.getByRole("button", { name: "Send to agent" }));

    expect(sendPromptToAgent).toHaveBeenCalledWith(
      "task-1",
      expect.stringContaining("Use the shared helper"),
      { keepReviewExpanded: true },
    );
    expect(useReviewDraftsStore.getState().getDraftCount("task-1")).toBe(0);
  });
});
