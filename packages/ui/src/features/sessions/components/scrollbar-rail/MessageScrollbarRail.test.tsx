import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MessageScrollbarRail } from "./MessageScrollbarRail";
import {
  MESSAGE_RAIL_LABEL_MAX_LENGTH,
  type MessageRailMarker,
  truncateMessageLabel,
} from "./messageRailTypes";

describe("truncateMessageLabel", () => {
  it("collapses newlines and trims", () => {
    expect(truncateMessageLabel("  hello\n\n  world  ", 80)).toBe(
      "hello world",
    );
  });

  it("collapses runs of spaces/tabs to one space", () => {
    expect(truncateMessageLabel("hello\t\t   world", 80)).toBe("hello world");
  });

  it("returns short text unchanged", () => {
    expect(truncateMessageLabel("hi there", 80)).toBe("hi there");
  });

  it("appends an ellipsis past the limit", () => {
    const text = "a".repeat(MESSAGE_RAIL_LABEL_MAX_LENGTH + 10);
    const out = truncateMessageLabel(text, MESSAGE_RAIL_LABEL_MAX_LENGTH);
    expect(out.length).toBe(MESSAGE_RAIL_LABEL_MAX_LENGTH + 1);
    expect(out.endsWith("…")).toBe(true);
  });
});

function marker(overrides: Partial<MessageRailMarker>): MessageRailMarker {
  return {
    id: overrides.id ?? "m1",
    topPct: overrides.topPct ?? 0,
    heightPct: overrides.heightPct ?? 0.05,
    label: overrides.label ?? "first few words",
    active: overrides.active,
    onClick: overrides.onClick ?? vi.fn(),
  };
}

describe("MessageScrollbarRail", () => {
  it("renders nothing when there are no markers", () => {
    const { container } = render(<MessageScrollbarRail markers={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders one marker button per user message", () => {
    const { container } = render(
      <MessageScrollbarRail
        markers={[
          marker({ id: "m1", topPct: 0, label: "hello" }),
          marker({ id: "m2", topPct: 0.5, label: "world" }),
        ]}
      />,
    );
    // The rail is aria-hidden (the messages are already accessible in the
    // transcript), so query buttons within the container rather than by role.
    const buttons = container.querySelectorAll("button");
    expect(buttons).toHaveLength(2);
  });

  it("positions each marker at its fractional top offset", () => {
    const { container } = render(
      <MessageScrollbarRail
        markers={[
          marker({ id: "m1", topPct: 0.25 }),
          marker({ id: "m2", topPct: 0.75 }),
        ]}
      />,
    );
    const buttons = container.querySelectorAll("button");
    expect(buttons[0].getAttribute("style")).toContain("top: 25%");
    expect(buttons[1].getAttribute("style")).toContain("top: 75%");
  });

  it("calls onClick when a marker is clicked", () => {
    const onClick = vi.fn();
    const { container } = render(
      <MessageScrollbarRail markers={[marker({ id: "m1", onClick })]} />,
    );
    const button = container.querySelector("button");
    expect(button).not.toBeNull();
    button?.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
