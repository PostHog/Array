import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ThreadMessageRow } from "./ThreadPanel";

describe("ThreadMessageRow", () => {
  it("renders backend-authored agent announcements as Agent", () => {
    render(
      <ThreadMessageRow
        message={{
          id: "announcement",
          task: "task",
          author_kind: "agent",
          event: "canvas_created",
          payload: {},
          content: "Canvas created",
          created_at: "2026-07-17T00:00:00Z",
          author: null,
        }}
        isTaskAuthor={false}
        isOwnMessage={false}
        canForward={false}
        onSendToAgent={() => {}}
        onDelete={() => {}}
      />,
    );

    expect(screen.getByText("Agent")).toBeInTheDocument();
    expect(screen.queryByText("Unknown")).not.toBeInTheDocument();
  });

  it("renders system announcements as System without human actions", () => {
    render(
      <ThreadMessageRow
        message={{
          id: "system-announcement",
          task: "task",
          author_kind: "system",
          event: "status_changed",
          payload: {},
          content: "Status changed",
          created_at: "2026-07-17T00:00:00Z",
          author: null,
        }}
        isTaskAuthor
        isOwnMessage={false}
        canForward
        onSendToAgent={() => {}}
        onDelete={() => {}}
      />,
    );

    expect(screen.getByText("System")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Message actions" }),
    ).not.toBeInTheDocument();
  });

  it("keeps legacy authorless rows as human messages", () => {
    render(
      <ThreadMessageRow
        message={{
          id: "legacy-message",
          task: "task",
          content: "Author removed",
          created_at: "2026-07-17T00:00:00Z",
          author: null,
        }}
        isTaskAuthor
        isOwnMessage={false}
        canForward
        onSendToAgent={() => {}}
        onDelete={() => {}}
      />,
    );

    expect(screen.getByText("Unknown")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Message actions" }),
    ).toBeInTheDocument();
  });
});
