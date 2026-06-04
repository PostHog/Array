import { Flex, Text } from "@radix-ui/themes";

// Placeholder for the Website space settings. Intentionally inert for now.
export function WebsiteSettings() {
  return (
    <Flex
      direction="column"
      align="center"
      justify="center"
      height="100%"
      gap="1"
    >
      <Text size="3" weight="bold" className="text-gray-12">
        Website settings
      </Text>
      <Text size="2" className="text-gray-10">
        Nothing to configure yet.
      </Text>
    </Flex>
  );
}
