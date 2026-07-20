import { Check, Copy } from "@phosphor-icons/react";
import { Tooltip } from "@posthog/ui/primitives/Tooltip";
import { Flex, IconButton, Text } from "@radix-ui/themes";
import { useCallback, useState } from "react";

export function CopyableCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [command]);

  return (
    <Flex
      align="center"
      gap="2"
      className="rounded border border-gray-6 bg-gray-2 px-2 py-1"
    >
      <Text className="text-[13px] text-gray-11">{command}</Text>
      <Tooltip content={copied ? "Copied!" : "Copy"}>
        <IconButton
          variant="ghost"
          size="1"
          color={copied ? "green" : "gray"}
          onClick={handleCopy}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
        </IconButton>
      </Tooltip>
    </Flex>
  );
}
