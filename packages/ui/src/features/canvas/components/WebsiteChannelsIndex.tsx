import { PlusIcon } from "@phosphor-icons/react";
import { Button } from "@posthog/quill";
import { CreateChannelModal } from "@posthog/ui/features/canvas/components/CreateChannelModal";
import { useChannels } from "@posthog/ui/features/canvas/hooks/useChannels";
import { Flex, Text } from "@radix-ui/themes";
import { Navigate } from "@tanstack/react-router";
import { useState } from "react";

// /website index: send the user to their first channel, or prompt them to
// create one when none exist yet.
export function WebsiteChannelsIndex() {
  const { channels, isLoading } = useChannels();
  const [modalOpen, setModalOpen] = useState(false);

  if (isLoading) return null;

  if (channels.length > 0) {
    return (
      <Navigate
        to="/website/$channelId"
        params={{ channelId: channels[0].id }}
        replace
      />
    );
  }

  return (
    <Flex
      direction="column"
      align="center"
      justify="center"
      height="100%"
      gap="3"
      className="px-6 text-center"
    >
      <Flex direction="column" gap="1">
        <Text size="3" weight="bold" className="text-gray-12">
          No channels yet
        </Text>
        <Text size="2" className="text-gray-10">
          Create a channel to get its own canvases, tasks, and settings.
        </Text>
      </Flex>
      <Button variant="primary" onClick={() => setModalOpen(true)}>
        <PlusIcon size={14} />
        Create channel
      </Button>
      <CreateChannelModal open={modalOpen} onOpenChange={setModalOpen} />
    </Flex>
  );
}
