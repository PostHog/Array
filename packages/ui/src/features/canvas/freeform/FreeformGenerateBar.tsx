import { SparkleIcon } from "@phosphor-icons/react";
import { useGenerateFreeformCanvas } from "@posthog/ui/features/canvas/hooks/useGenerateFreeformCanvas";
import { Button, Flex, Spinner, TextArea } from "@radix-ui/themes";

// Composer that kicks off freeform canvas generation as a dedicated task: the
// user describes what they want and the agent builds + publishes the canvas. No
// repo is picked up front — the agent attaches one lazily only if it needs it.
// Used both for the first build (empty canvas) and for follow-up edits
// (currentCode passed in).
export function FreeformGenerateBar({
  dashboardId,
  channelId,
  channelName,
  name,
  templateId,
  currentCode,
  value,
  onValueChange,
  onStarted,
}: {
  dashboardId: string;
  channelId: string;
  channelName: string;
  name: string;
  templateId?: string;
  currentCode?: string;
  // Controlled draft text (so a self-repair action can prefill it).
  value: string;
  onValueChange: (next: string) => void;
  onStarted?: (taskId: string) => void;
}) {
  const { generate, isStarting } = useGenerateFreeformCanvas({
    dashboardId,
    channelId,
    name,
    channelName,
    templateId,
  });
  const draft = value;
  const setDraft = onValueChange;
  const isEdit = !!currentCode?.trim();

  const run = async () => {
    const instruction = draft.trim();
    if (!instruction) return;
    const taskId = await generate({ instruction, currentCode });
    if (taskId) {
      setDraft("");
      onStarted?.(taskId);
    }
  };

  return (
    <Flex
      direction="column"
      gap="2"
      className="mx-auto w-full max-w-[480px] rounded-lg border border-gray-6 bg-gray-2 p-3"
    >
      <TextArea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={
          isEdit
            ? "Describe the change you want…"
            : "Describe the canvas you want. The agent builds a React app from your PostHog data."
        }
        rows={3}
        disabled={isStarting}
      />
      <Flex align="center" justify="end" gap="2">
        <Button
          size="2"
          variant="solid"
          disabled={!draft.trim() || isStarting}
          onClick={() => void run()}
        >
          {isStarting ? <Spinner size="1" /> : <SparkleIcon size={14} />}
          {isEdit ? "Edit" : "Generate"}
        </Button>
      </Flex>
    </Flex>
  );
}
