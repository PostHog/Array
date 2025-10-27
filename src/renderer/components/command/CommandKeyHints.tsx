import { KeyHint } from "@components/command/KeyHint";
import { Code, Flex } from "@radix-ui/themes";

export function CommandKeyHints() {
  return (
    <Flex
      align="center"
      justify="center"
      gap="4"
      px="3"
      py="2"
      style={{ flexShrink: 0 }}
      className="border-gray-6 border-t bg-gray-1"
    >
      <Flex align="center" gap="2">
        <KeyHint keys={["↑", "↓"]} />
        <Code size="1" variant="ghost" color="gray">
          Navigate
        </Code>
      </Flex>
      <Flex align="center" gap="2">
        <KeyHint keys={["↵"]} />
        <Code size="1" variant="ghost" color="gray">
          Select
        </Code>
      </Flex>
      <Flex align="center" gap="2">
        <KeyHint keys={["Esc"]} />
        <Code size="1" variant="ghost" color="gray">
          Close
        </Code>
      </Flex>
    </Flex>
  );
}
