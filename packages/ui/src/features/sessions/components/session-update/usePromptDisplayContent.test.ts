import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { usePromptDisplayContent } from "./usePromptDisplayContent";

function render(content: string, bluebirdEnabled = false) {
  return renderHook(
    ({ content, bluebirdEnabled }) =>
      usePromptDisplayContent(content, bluebirdEnabled),
    { initialProps: { content, bluebirdEnabled } },
  ).result.current;
}

describe("usePromptDisplayContent", () => {
  it("passes plain prompts through unchanged", () => {
    const { displayContent, channelContext, canvasInstructions } =
      render("ship the fix");
    expect(displayContent).toBe("ship the fix");
    expect(channelContext).toBeNull();
    expect(canvasInstructions).toBeNull();
  });

  it("strips every injected block from the display text", () => {
    const content =
      'do the thing\n<channel_context channel="billing">\n# Billing\n</channel_context>\n<canvas_generation_instructions>\nauthoring contract\n</canvas_generation_instructions>\n<user_custom_instructions>\nAlways be brief.\n</user_custom_instructions>';
    const result = render(content);
    expect(result.displayContent).toBe("do the thing");
  });

  it("gates the tags on the bluebird flag while always stripping", () => {
    const content =
      'do the thing\n<channel_context channel="billing">\n# Billing\n</channel_context>\n<canvas_generation_instructions>\ncontract\n</canvas_generation_instructions>';
    const off = render(content, false);
    expect(off.showChannelContextTag).toBe(false);
    expect(off.showCanvasInstructionsTag).toBe(false);
    expect(off.displayContent).toBe("do the thing");

    const on = render(content, true);
    expect(on.showChannelContextTag).toBe(true);
    expect(on.showCanvasInstructionsTag).toBe(true);
    expect(on.channelContext?.mention.name).toBe("billing");
  });

  it("strips custom instructions without surfacing a tag", () => {
    const content =
      "ship it\n<user_custom_instructions>\nbe brief\n</user_custom_instructions>";
    const result = render(content, true);
    expect(result.displayContent).toBe("ship it");
    expect(result.showChannelContextTag).toBe(false);
    expect(result.showCanvasInstructionsTag).toBe(false);
  });
});
