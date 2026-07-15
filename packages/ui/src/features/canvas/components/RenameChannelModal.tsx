import { XIcon } from "@phosphor-icons/react";
import { validateChannelName } from "@posthog/core/canvas/channelName";
import { Button } from "@posthog/quill";
import { ANALYTICS_EVENTS } from "@posthog/shared/analytics-events";
import { useRepointChannelStar } from "@posthog/ui/features/canvas/hooks/useChannelStars";
import type { Channel } from "@posthog/ui/features/canvas/hooks/useChannels";
import { useChannelMutations } from "@posthog/ui/features/canvas/hooks/useChannels";
import { useRenameBackendChannel } from "@posthog/ui/features/canvas/hooks/useTaskChannels";
import { toast } from "@posthog/ui/primitives/toast";
import { track } from "@posthog/ui/shell/analytics";
import { Dialog, Flex, IconButton, Text, TextField } from "@radix-ui/themes";
import { SquircleDashed } from "lucide-react";
import { useEffect, useState } from "react";

// Matches the create-channel naming constraint.
const MAX_CHANNEL_NAME_LENGTH = 80;

interface RenameChannelModalProps {
  channel: Channel;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RenameChannelModal({
  channel,
  open,
  onOpenChange,
}: RenameChannelModalProps) {
  const { renameChannel, isRenaming } = useChannelMutations();
  const repointStar = useRepointChannelStar();
  const renameBackendChannel = useRenameBackendChannel();
  const [name, setName] = useState(channel.name);

  // Seed the field with the current name each time the modal opens.
  useEffect(() => {
    if (open) setName(channel.name);
  }, [open, channel.name]);

  const trimmed = name.trim();
  const remaining = MAX_CHANNEL_NAME_LENGTH - name.length;
  const unchanged = trimmed === channel.name;
  const validationError = validateChannelName(trimmed);

  const submit = async () => {
    if (!trimmed || unchanged || validationError || isRenaming) return;
    // Capture the pre-rename identity: name keys the backend feed channel, path
    // keys the star. Both go stale the moment the rename lands.
    const previousName = channel.name;
    const previousPath = channel.path;
    try {
      const renamed = await renameChannel(channel.id, trimmed);
      // Carry the name-keyed dependents over to the new name so the context's
      // task history and star survive the rename. They're independent (feed vs
      // star, different caches), so run them together. Both are best-effort and
      // never throw, so a hiccup can't turn a successful rename into an error.
      await Promise.all([
        renameBackendChannel(previousName, trimmed),
        repointStar(previousPath, renamed),
      ]);
      track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
        action_type: "rename",
        surface: "sidebar",
        channel_id: channel.id,
        success: true,
      });
      onOpenChange(false);
    } catch (error) {
      track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
        action_type: "rename",
        surface: "sidebar",
        channel_id: channel.id,
        success: false,
      });
      toast.error("Couldn't rename context", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!isRenaming) onOpenChange(next);
      }}
    >
      <Dialog.Content maxWidth="560px">
        <Flex align="start" justify="between" gap="3">
          <Dialog.Title>
            <Text className="font-bold text-lg">Rename context</Text>
          </Dialog.Title>
          <Dialog.Close>
            <IconButton
              variant="ghost"
              color="gray"
              size="2"
              aria-label="Close"
              disabled={isRenaming}
            >
              <XIcon size={18} />
            </IconButton>
          </Dialog.Close>
        </Flex>

        <Flex direction="column" gap="2" mt="4">
          <Text
            as="label"
            htmlFor="rename-channel-name"
            className="font-medium text-sm"
          >
            Name
          </Text>
          <TextField.Root
            id="rename-channel-name"
            autoFocus
            size="3"
            value={name}
            placeholder="e.g. mobile"
            maxLength={MAX_CHANNEL_NAME_LENGTH}
            disabled={isRenaming}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void submit();
              }
            }}
          >
            <TextField.Slot>
              <SquircleDashed size={16} className="text-gray-10" />
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
        </Flex>

        <Flex gap="3" mt="5" justify="end">
          <Button
            variant="primary"
            disabled={!trimmed || unchanged || !!validationError || isRenaming}
            onClick={submit}
          >
            Rename
          </Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
