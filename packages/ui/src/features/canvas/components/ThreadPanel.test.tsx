import type { ConversationItem } from "@posthog/ui/features/sessions/components/buildConversationItems";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  AgentStatusLine,
  ThreadMessageRow,
  UserPromptRow,
} from "./ThreadPanel";
import { agentTurns } from "./threadAgentTurns";

describe("agentTurns", () => {
  it("accumulates every text chunk in one agent turn", () => {
    const items = [
      {
        type: "session_update",
        id: "first",
        timestamp: 10,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Hello" },
        },
      },
      {
        type: "session_update",
        id: "second",
        timestamp: 20,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: " there" },
        },
      },
    ] as ConversationItem[];

    expect(agentTurns(items)).toEqual([
      { id: "first", text: "Hello there", timestamp: 10 },
    ]);
  });
});

describe("AgentStatusLine", () => {
  it("renders working status outside the conversation timeline", () => {
    render(<AgentStatusLine status={{ phase: "active", label: "Working…" }} />);

    const status = screen.getByText("Working…");

    expect(status.closest("article")).toBeNull();
    expect(status.closest('[data-slot="thread-item-body"]')).toBeNull();
    expect(status.closest("output")).not.toBeNull();
  });
});

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

describe("UserPromptRow", () => {
  it("prefixes direct task prompts with @agent", () => {
    render(
      <UserPromptRow
        message={{ id: "prompt", text: "Investigate this", timestamp: 1 }}
        author={{ id: 1, uuid: "user", email: "user@example.com" }}
      />,
    );

    expect(screen.getByText("@agent")).toBeInTheDocument();
    expect(screen.getByText("Investigate this")).toBeInTheDocument();
  });

  it("hides forwarded thread attribution and duplicate agent mentions", () => {
    render(
      <UserPromptRow
        message={{
          id: "prompt",
          text: "[Thread comment from Peter Kirkham] @agent which model are you?",
          timestamp: 1,
        }}
        author={{ id: 1, uuid: "user", email: "user@example.com" }}
      />,
    );

    expect(screen.getAllByText("@agent")).toHaveLength(1);
    expect(screen.getByText("which model are you?")).toBeInTheDocument();
    expect(screen.queryByText(/Thread comment from/)).not.toBeInTheDocument();
  });

  it("strips injected custom-instructions and channel-context XML", () => {
    render(
      <UserPromptRow
        message={{
          id: "prompt",
          text: 'ship the fix\n<user_custom_instructions>\nAlways be brief.\n</user_custom_instructions>\n<channel_context channel="billing">\n# Billing\n</channel_context>',
          timestamp: 1,
        }}
        author={{ id: 1, uuid: "user", email: "user@example.com" }}
      />,
    );

    expect(screen.getByText("ship the fix")).toBeInTheDocument();
    expect(
      screen.queryByText(/user_custom_instructions/),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/channel_context/)).not.toBeInTheDocument();
    expect(screen.queryByText("Always be brief.")).not.toBeInTheDocument();
  });

  it("renders an injected PR chip instead of its raw XML", () => {
    render(
      <UserPromptRow
        message={{
          id: "prompt",
          text: 'review <github_pr number="42" title="Fix login" url="https://github.com/org/repo/pull/42" />',
          timestamp: 1,
        }}
        author={{ id: 1, uuid: "user", email: "user@example.com" }}
      />,
    );

    expect(screen.queryByText(/github_pr/)).not.toBeInTheDocument();
    expect(screen.getByText("#42 - Fix login")).toBeInTheDocument();
  });
});
