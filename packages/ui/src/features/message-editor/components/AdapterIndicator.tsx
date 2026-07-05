import { Robot } from "@phosphor-icons/react";
import { Flex, Text } from "@radix-ui/themes";

interface AdapterIndicatorProps {
  adapter: "claude" | "codex";
}

export function AdapterIndicator({ adapter }: AdapterIndicatorProps) {
  return (
    <Flex align="center" gap="1">
      <Robot size={12} weight="duotone" className="text-(--gray-9)" />
      <Text className="font-mono text-(--gray-9) text-[13px]">{adapter}</Text>
    </Flex>
  );
}
