import { Flex, Heading, Text } from "@radix-ui/themes";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: HomeRoute,
});

function HomeRoute() {
  return (
    <Flex
      direction="column"
      align="center"
      justify="center"
      height="100%"
      gap="2"
    >
      <Heading size="6">Hello world</Heading>
      <Text className="text-gray-10">Welcome to your Home space.</Text>
    </Flex>
  );
}
