import {
  HTML_CANVAS_MESSAGE_CHANNEL,
  commentAnchorSchema,
  hostToHtmlCanvasMessageSchema,
  htmlCanvasToHostMessageSchema,
  isHtmlTemplate,
} from "@posthog/core/canvas/htmlCanvasSchemas";
import { describe, expect, it } from "vitest";

const channel = HTML_CANVAS_MESSAGE_CHANNEL;
const rect = { top: 10, left: 20, width: 100, height: 40 };

describe("isHtmlTemplate", () => {
  it.each([
    ["html", true],
    ["freeform", false],
    ["dashboard", false],
    [undefined, false],
  ])("templateId %s -> %s", (id, expected) => {
    expect(isHtmlTemplate(id as string | undefined)).toBe(expected);
  });
});

describe("commentAnchorSchema", () => {
  it("parses each anchor kind and defaults text context to empty strings", () => {
    const text = commentAnchorSchema.parse({ type: "text", quote: "revenue" });
    expect(text).toEqual({
      type: "text",
      quote: "revenue",
      prefix: "",
      suffix: "",
    });
    expect(
      commentAnchorSchema.parse({ type: "element", selector: "#pricing" }),
    ).toEqual({ type: "element", selector: "#pricing", label: "" });
    expect(commentAnchorSchema.parse({ type: "page" })).toEqual({
      type: "page",
    });
  });

  it("rejects unknown kinds and empty required fields", () => {
    expect(commentAnchorSchema.safeParse({ type: "line" }).success).toBe(false);
    expect(
      commentAnchorSchema.safeParse({ type: "text", quote: "" }).success,
    ).toBe(false);
    expect(
      commentAnchorSchema.safeParse({ type: "element", selector: "" }).success,
    ).toBe(false);
  });
});

describe("host <-> shim protocol", () => {
  it("round-trips host -> shim frames", () => {
    const frames = [
      {
        channel,
        type: "set-annotations",
        annotations: [
          { id: "c1", index: 1, anchor: { type: "page" } },
          {
            id: "c2",
            index: 2,
            anchor: { type: "text", quote: "q", prefix: "", suffix: "" },
          },
        ],
      },
      { channel, type: "set-pick-mode", active: true },
      { channel, type: "set-active", id: "c1", scroll: true },
      { channel, type: "set-active", id: null, scroll: false },
      { channel, type: "clear-draft" },
    ];
    for (const frame of frames) {
      expect(hostToHtmlCanvasMessageSchema.parse(frame)).toEqual(frame);
    }
  });

  it("round-trips shim -> host frames", () => {
    const frames = [
      { channel, type: "ready" },
      {
        channel,
        type: "selection",
        anchor: { type: "text", quote: "q", prefix: "a", suffix: "b" },
        rect,
      },
      { channel, type: "selection-cleared" },
      {
        channel,
        type: "element-picked",
        anchor: { type: "element", selector: "#x", label: "div" },
        rect,
      },
      {
        channel,
        type: "annotations-resolved",
        results: [
          { id: "c1", resolved: true, rect },
          { id: "c2", resolved: false },
        ],
      },
      { channel, type: "marker-clicked", id: "c1", rect },
      { channel, type: "error", message: "boom" },
    ];
    for (const frame of frames) {
      expect(htmlCanvasToHostMessageSchema.parse(frame)).toEqual(frame);
    }
  });

  it("rejects frames missing the channel stamp or with unknown types", () => {
    expect(
      htmlCanvasToHostMessageSchema.safeParse({ type: "ready" }).success,
    ).toBe(false);
    expect(
      htmlCanvasToHostMessageSchema.safeParse({
        channel: "posthog-canvas",
        type: "ready",
      }).success,
    ).toBe(false);
    expect(
      hostToHtmlCanvasMessageSchema.safeParse({ channel, type: "init" })
        .success,
    ).toBe(false);
  });
});
