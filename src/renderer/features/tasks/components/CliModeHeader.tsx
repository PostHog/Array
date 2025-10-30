import { CheckSquareIcon, TerminalWindowIcon } from "@phosphor-icons/react";
import { Flex, Text } from "@radix-ui/themes";

interface CliModeHeaderProps {
  cliMode: "task" | "shell";
}

export function CliModeHeader({ cliMode }: CliModeHeaderProps) {
  return (
    <Flex
      align="center"
      justify="between"
      p="2"
      style={{
        borderBottom: "1px solid var(--gray-a6)",
        fontFamily: "monospace",
        backgroundColor: "rgba(0, 0, 0, 0.2)",
        userSelect: "none",
        WebkitUserSelect: "none",
      }}
    >
      <Flex align="center" gap="2">
        {cliMode === "task" ? (
          <>
            <CheckSquareIcon size={16} weight="bold" color="var(--accent-11)" />
            <Text size="1" weight="bold" style={{ color: "var(--accent-11)" }}>
              Task mode
            </Text>
          </>
        ) : (
          <>
            <TerminalWindowIcon
              size={16}
              weight="bold"
              color="var(--accent-11)"
            />
            <Text size="1" weight="bold" style={{ color: "var(--accent-11)" }}>
              Shell mode
            </Text>
          </>
        )}
      </Flex>
      <Flex
        align="center"
        gap="1"
        style={{
          fontSize: "var(--font-size-1)",
          color: "var(--gray-9)",
          fontFamily: "monospace",
        }}
      >
        <Text size="1" weight="bold">
          Shift
        </Text>
        <Text size="1">+</Text>
        <Text size="1" weight="bold">
          Tab
        </Text>
        <Text size="1">to switch</Text>
      </Flex>
    </Flex>
  );
}
