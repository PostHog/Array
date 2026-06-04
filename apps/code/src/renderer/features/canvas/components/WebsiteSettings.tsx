import { useChannels } from "@features/canvas/hooks/useChannels";
import { Flex, Text } from "@radix-ui/themes";

// Placeholder for a channel's settings. Intentionally inert for now.
export function WebsiteSettings({ channelId }: { channelId: string }) {
  const { channels } = useChannels();
  const name = channels.find((c) => c.id === channelId)?.name ?? "Channel";

  return (
    <Flex
      direction="column"
      align="center"
      justify="center"
      height="100%"
      gap="1"
    >
      <Text size="3" weight="bold" className="text-gray-12">
        {name} settings
      </Text>
      <Text size="2" className="text-gray-10">
        Nothing to configure yet.
      </Text>
    </Flex>
  );
}
