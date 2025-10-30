import { Flex, Spinner, Text } from "@radix-ui/themes";

interface CliStatusIndicatorProps {
  cliMode: "task" | "shell";
  isCreatingTask: boolean;
}

export function CliStatusIndicator({
  cliMode,
  isCreatingTask,
}: CliStatusIndicatorProps) {
  if (cliMode !== "task") return null;

  return (
    <Flex
      align="center"
      gap="1"
      style={{
        position: "absolute",
        bottom: "8px",
        right: "8px",
        fontSize: "var(--font-size-1)",
        color: "var(--gray-9)",
        fontFamily: "monospace",
      }}
    >
      {isCreatingTask ? (
        <>
          <Spinner size="1" />
          <Text size="1">
            Spawning task
            <span className="loading-dots" />
          </Text>
        </>
      ) : (
        <>
          <Text size="1" weight="bold">
            {navigator.platform.includes("Mac") ? "⌘" : "Ctrl"}
          </Text>
          <Text size="1">+</Text>
          <Text size="1" weight="bold">
            Enter
          </Text>
          <Text size="1">to submit</Text>
        </>
      )}
    </Flex>
  );
}
