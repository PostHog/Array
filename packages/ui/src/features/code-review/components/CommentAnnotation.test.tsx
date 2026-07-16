import { Theme } from "@radix-ui/themes";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useReviewDraftsStore } from "../reviewDraftsStore";
import { CommentAnnotation } from "./CommentAnnotation";

const { sendPromptToAgent } = vi.hoisted(() => ({
  sendPromptToAgent: vi.fn(),
}));

vi.mock("../../sessions/sendPromptToAgent", () => ({ sendPromptToAgent }));

describe("CommentAnnotation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useReviewDraftsStore.setState({ drafts: {}, batchEnabled: {} });
  });

  it("keeps expanded review open when sending an inline comment", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();

    render(
      <Theme>
        <CommentAnnotation
          taskId="task-1"
          filePath="src/example.ts"
          startLine={8}
          endLine={10}
          side="additions"
          onDismiss={onDismiss}
        />
      </Theme>,
    );

    await user.type(
      screen.getByPlaceholderText("Describe the changes you'd like..."),
      "Use the shared helper",
    );
    await user.click(screen.getByRole("button", { name: "Submit" }));

    expect(sendPromptToAgent).toHaveBeenCalledWith(
      "task-1",
      expect.stringContaining("Use the shared helper"),
      { keepReviewExpanded: true },
    );
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
