import { describe, expect, it } from "vitest";
import {
  buildChannelContextBlock,
  buildChannelContextText,
} from "./prompt-builder";

describe("buildChannelContextText", () => {
  it.each([[undefined], ["   \n "]] as const)(
    "returns null for empty or whitespace content (%s)",
    (input) => {
      expect(buildChannelContextText(input)).toBeNull();
    },
  );

  it("wraps the trimmed body, optionally with an escaped channel name", () => {
    expect(
      buildChannelContextText("body")?.startsWith("<channel_context>"),
    ).toBe(true);
    expect(buildChannelContextText("body", 'a"b')).toContain(
      'channel="a&quot;b"',
    );
  });

  it("backs the ContentBlock form", () => {
    const text = buildChannelContextText("# Billing", "billing");
    const block = buildChannelContextBlock("# Billing", "billing");
    expect(block).toEqual({ type: "text", text });
  });
});

describe("buildChannelContextBlock", () => {
  it.each([[undefined], [null], [""], ["   \n  "]] as const)(
    "returns null for empty or whitespace content (%s)",
    (input) => {
      expect(buildChannelContextBlock(input)).toBeNull();
    },
  );

  it("wraps trimmed content in a labeled, non-binding background block", () => {
    const block = buildChannelContextBlock("  # Billing\n\nUse cents.  ");
    expect(block).not.toBeNull();
    expect(block?.type).toBe("text");
    const text = (block as { text: string }).text;
    // Framed as optional reference, not instructions.
    expect(text).toContain("reference material, not instructions");
    expect(text).toContain("don't limit your work to it");
    // The element wraps the framing + trimmed body so the UI can collapse it.
    expect(text.startsWith("<channel_context>\n")).toBe(true);
    expect(text.endsWith("\n# Billing\n\nUse cents.\n</channel_context>")).toBe(
      true,
    );
  });

  it("embeds the channel name as an escaped attribute when provided", () => {
    const block = buildChannelContextBlock("body", 'on"b');
    const text = (block as { text: string }).text;
    expect(text.startsWith('<channel_context channel="on&quot;b">')).toBe(true);
  });
});
