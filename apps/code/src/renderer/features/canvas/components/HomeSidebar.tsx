import { Box, Flex, Text } from "@radix-ui/themes";

// Home space sidenav. Mirrors the code app's MainSidebar slot but is tied to
// the / route. Intentionally minimal for now — fills out as the Home space
// grows.
export function HomeSidebar() {
  return (
    <Box
      className="h-full shrink-0 border-gray-6 border-r bg-gray-1"
      style={{ width: 240, minWidth: 240 }}
    >
      <Flex direction="column" gap="1" p="3">
        <Text size="2" weight="bold" className="text-gray-12">
          Home
        </Text>
        <Text size="1" className="text-gray-10">
          Your space overview
        </Text>
      </Flex>
    </Box>
  );
}
