import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ConversationItem } from "./buildConversationItems";
import {
  ConversationMinimap,
  type MinimapMessage,
  toMinimapMessages,
} from "./ConversationMinimap";

function userMessage(id: string, content: string): ConversationItem {
  return { type: "user_message", id, content, timestamp: 0 };
}

describe("toMinimapMessages", () => {
  it("keeps only user messages, in conversation order", () => {
    const items: ConversationItem[] = [
      userMessage("u1", "first"),
      { type: "turn_cancelled", id: "t1" },
      userMessage("u2", "second"),
    ];

    expect(toMinimapMessages(items)).toEqual([
      { id: "u1", preview: "first" },
      { id: "u2", preview: "second" },
    ]);
  });

  it("collapses whitespace and truncates long content for the preview", () => {
    const [message] = toMinimapMessages([
      userMessage("u1", `line one\n\nline two ${"x".repeat(200)}`),
    ]);

    expect(message.preview.startsWith("line one line two")).toBe(true);
    expect(message.preview.endsWith("…")).toBe(true);
    // 80 preview chars plus the ellipsis.
    expect(message.preview).toHaveLength(81);
  });
});

describe("ConversationMinimap", () => {
  const messages: MinimapMessage[] = [
    { id: "u1", preview: "first message" },
    { id: "u2", preview: "second message" },
    { id: "u3", preview: "third message" },
  ];

  it.each([
    { name: "no messages", few: [] as MinimapMessage[] },
    { name: "a single message", few: messages.slice(0, 1) },
  ])("renders nothing with $name", ({ few }) => {
    const { container } = render(
      <ConversationMinimap messages={few} activeId={null} onSelect={vi.fn()} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("renders one marker per message and jumps to the clicked one", () => {
    const onSelect = vi.fn();
    render(
      <ConversationMinimap
        messages={messages}
        activeId={null}
        onSelect={onSelect}
      />,
    );

    const nav = screen.getByRole("navigation", {
      name: "Conversation minimap",
    });
    const markers = within(nav).getAllByRole("button");
    expect(markers).toHaveLength(3);

    fireEvent.click(markers[1]);
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("u2");
  });

  it("marks the anchored message with aria-current", () => {
    render(
      <ConversationMinimap
        messages={messages}
        activeId="u3"
        onSelect={vi.fn()}
      />,
    );

    const markers = screen.getAllByRole("button");
    expect(markers[2]).toHaveAttribute("aria-current", "true");
    expect(markers[0]).not.toHaveAttribute("aria-current");
    expect(markers[2]).toHaveAccessibleName(
      "Jump to message 3 of 3: third message",
    );
  });
});
