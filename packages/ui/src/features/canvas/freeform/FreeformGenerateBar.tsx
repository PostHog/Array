import { useGenerateFreeformCanvas } from "@posthog/ui/features/canvas/hooks/useGenerateFreeformCanvas";
import { PromptInput } from "@posthog/ui/features/message-editor/components/PromptInput";
import type { EditorHandle } from "@posthog/ui/features/message-editor/types";
import { forwardRef } from "react";

// Composer that kicks off freeform canvas generation as a dedicated task: the
// user describes what they want and the agent builds + publishes the canvas. No
// repo is picked up front — the agent attaches one lazily only if it needs it.
// Used both for the first build (empty canvas) and for follow-up edits
// (currentCode passed in).
//
// Shares the task composer's editor (PromptInput) so it matches it exactly — @
// for files, / for skills, ↑↓ for history — but renders a blank toolbar for now:
// just the send button, none of the attach/mode/model/history addons. The
// forwarded ref exposes the editor handle so callers can prefill it (suggestion
// cards, self-repair).
export const FreeformGenerateBar = forwardRef<
  EditorHandle,
  {
    dashboardId: string;
    channelId: string;
    channelName: string;
    name: string;
    templateId?: string;
    currentCode?: string;
    // Keys the editor's draft/command state; distinct per canvas.
    sessionId: string;
    onStarted?: (taskId: string) => void;
  }
>(function FreeformGenerateBar(
  {
    dashboardId,
    channelId,
    channelName,
    name,
    templateId,
    currentCode,
    sessionId,
    onStarted,
  },
  ref,
) {
  const { generate, isStarting } = useGenerateFreeformCanvas({
    dashboardId,
    channelId,
    name,
    channelName,
    templateId,
  });

  const run = async (text: string) => {
    const instruction = text.trim();
    if (!instruction) return;
    const taskId = await generate({ instruction, currentCode });
    if (taskId) onStarted?.(taskId);
  };

  return (
    <PromptInput
      ref={ref}
      sessionId={sessionId}
      editorHeight="large"
      disabled={isStarting}
      isLoading={isStarting}
      enableCommands
      enableBashMode={false}
      hideDefaultToolbar
      onSubmit={(text) => void run(text)}
    />
  );
});
