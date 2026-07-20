import { useMemo } from "react";
import { extractCanvasInstructions } from "./canvasInstructions";
import { extractChannelContext } from "./channelContext";
import { extractCustomInstructions } from "./customInstructions";

export interface PromptDisplayContent {
  /** Prompt text with every injected XML block stripped. */
  displayContent: string;
  /** Parsed channel-context mention, or null when none was injected. */
  channelContext: ReturnType<typeof extractChannelContext>;
  /** Parsed canvas-instructions block, or null when none was injected. */
  canvasInstructions: ReturnType<typeof extractCanvasInstructions>;
  /** Whether the channel-context tag should render (flag-gated). */
  showChannelContextTag: boolean;
  /** Whether the canvas-instructions tag should render (flag-gated). */
  showCanvasInstructionsTag: boolean;
}

// A prompt may carry up to three injected XML blocks that the conversation UI
// must never render inline: a channel's CONTEXT.md, the canvas authoring
// contract, and the user's saved personalization. Each is stripped in turn so
// the user's own request renders cleanly; the channel-context and
// canvas-instructions bodies are also surfaced as clickable tags (gated on the
// project-bluebird flag so flag-off viewers get the strip without the tag).
// custom-instructions is always-on background, so it's stripped with no tag.
export function usePromptDisplayContent(
  content: string,
  bluebirdEnabled: boolean,
): PromptDisplayContent {
  const channelContext = useMemo(
    () => extractChannelContext(content),
    [content],
  );
  const afterChannelContext = channelContext
    ? channelContext.stripped
    : content;
  const canvasInstructions = useMemo(
    () => extractCanvasInstructions(afterChannelContext),
    [afterChannelContext],
  );
  const afterCanvasInstructions = canvasInstructions
    ? canvasInstructions.stripped
    : afterChannelContext;
  const customInstructions = useMemo(
    () => extractCustomInstructions(afterCanvasInstructions),
    [afterCanvasInstructions],
  );
  const displayContent = customInstructions
    ? customInstructions.stripped
    : afterCanvasInstructions;
  return {
    displayContent,
    channelContext,
    canvasInstructions,
    showChannelContextTag: !!channelContext && bluebirdEnabled,
    showCanvasInstructionsTag: !!canvasInstructions && bluebirdEnabled,
  };
}
