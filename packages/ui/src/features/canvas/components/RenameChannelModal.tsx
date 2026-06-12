import { HashIcon, XIcon } from "@phosphor-icons/react";
import { Button } from "@posthog/quill";
import type { Channel } from "@posthog/ui/features/canvas/hooks/useChannels";
import { useChannelMutations } from "@posthog/ui/features/canvas/hooks/useChannels";
import { toast } from "@posthog/ui/primitives/toast";
import { Dialog, Flex, IconButton, Text, TextField } from "@radix-ui/themes";
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
  const [name, setName] = useState(channel.name);

  // Seed the field with the current name each time the modal opens.
  useEffect(() => {
    if (open) setName(channel.name);
  }, [open, channel.name]);

  const trimmed = name.trim();
  const remaining = MAX_CHANNEL_NAME_LENGTH - name.length;
  const unchanged = trimmed === channel.name;

  const submit = async () => {
    if (!trimmed || unchanged || isRenaming) return;
    try {
      await renameChannel(channel.id, trimmed);
      onOpenChange(false);
    } catch (error) {
      toast.error("Couldn't rename channel", {
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
            <Text className="font-bold text-lg">Rename channel</Text>
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
              <HashIcon size={16} className="text-gray-10" />
            </TextField.Slot>
            <TextField.Slot side="right">
              <Text className="text-gray-9 text-sm tabular-nums">
                {remaining}
              </Text>
            </TextField.Slot>
          </TextField.Root>
        </Flex>

        <Flex gap="3" mt="5" justify="end">
          <Button
            variant="primary"
            disabled={!trimmed || unchanged || isRenaming}
            onClick={submit}
          >
            Rename
          </Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
