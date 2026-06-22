import { HashIcon, XIcon } from "@phosphor-icons/react";
import { validateChannelName } from "@posthog/core/canvas/channelName";
import { Button } from "@posthog/quill";
import { ANALYTICS_EVENTS } from "@posthog/shared/analytics-events";
import { useChannelMutations } from "@posthog/ui/features/canvas/hooks/useChannels";
import { useOpenHomeCanvas } from "@posthog/ui/features/canvas/hooks/useDashboards";
import { toast } from "@posthog/ui/primitives/toast";
import { track } from "@posthog/ui/shell/analytics";
import { Dialog, Flex, IconButton, Text, TextField } from "@radix-ui/themes";
import { useState } from "react";

// Matches Slack's "Create a channel" naming constraint.
const MAX_CHANNEL_NAME_LENGTH = 80;

interface CreateChannelModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateChannelModal({
  open,
  onOpenChange,
}: CreateChannelModalProps) {
  const { createChannel, isCreating } = useChannelMutations();
  const openHomeCanvas = useOpenHomeCanvas();
  const [name, setName] = useState("");

  // Reset the field each time the modal opens so a previous draft never lingers.
  // Adjusted inline during render (prev-prop comparison) rather than in an
  // effect, which would flash a stale value for one commit.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setName("");
  }

  const trimmed = name.trim();
  const remaining = MAX_CHANNEL_NAME_LENGTH - name.length;
  const validationError = validateChannelName(trimmed);

  const submit = async () => {
    if (!trimmed || validationError || isCreating) return;
    let channel: Awaited<ReturnType<typeof createChannel>>;
    try {
      channel = await createChannel(trimmed);
      track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
        action_type: "create",
        surface: "sidebar",
        channel_id: channel.id,
        success: true,
      });
    } catch (error) {
      track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
        action_type: "create",
        surface: "sidebar",
        success: false,
      });
      toast.error("Couldn't create channel", {
        description: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    onOpenChange(false);
    // Create + seed the channel's home canvas and open it in the main pane. A
    // freshly created channel has no homeCanvasId yet, so this creates one.
    await openHomeCanvas(channel);
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!isCreating) onOpenChange(next);
      }}
    >
      <Dialog.Content maxWidth="560px">
        <Flex align="start" justify="between" gap="3">
          <Dialog.Title>
            <Text className="font-bold text-lg">Create a channel</Text>
          </Dialog.Title>
          <Dialog.Close>
            <IconButton
              variant="ghost"
              color="gray"
              size="2"
              aria-label="Close"
              disabled={isCreating}
            >
              <XIcon size={18} />
            </IconButton>
          </Dialog.Close>
        </Flex>

        <Flex direction="column" gap="2" mt="4">
          <Text
            as="label"
            htmlFor="channel-name"
            className="font-medium text-sm"
          >
            Name
          </Text>
          <TextField.Root
            id="channel-name"
            autoFocus
            size="3"
            value={name}
            placeholder="e.g. mobile"
            maxLength={MAX_CHANNEL_NAME_LENGTH}
            disabled={isCreating}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void submit();
              }
            }}
          >
            <TextField.Slot>
              <HashIcon size={16} className="text-gray-10" />
            </TextField.Slot>
            <TextField.Slot side="right">
              <Text className="text-gray-9 text-sm tabular-nums">
                {remaining}
              </Text>
            </TextField.Slot>
          </TextField.Root>
          {validationError && (
            <Text color="red" className="text-sm">
              {validationError}
            </Text>
          )}
          <Text className="text-gray-10 text-sm">
            Each channel gets its own dashboards, tasks, and settings. Use a
            name that's easy to find.
          </Text>
        </Flex>

        <Flex gap="3" mt="5" justify="end">
          <Button
            variant="primary"
            disabled={!trimmed || !!validationError || isCreating}
            onClick={submit}
          >
            Create
          </Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
