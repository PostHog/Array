import { SparkleIcon } from "@phosphor-icons/react";
import { AlertDialog, Button, Flex, Text } from "@radix-ui/themes";

/**
 * Confirm dialog shown when an "Edit with AI" / "New agent" seed lands while an
 * Agent Builder chat is already in progress: start a fresh chat for the seed, or
 * send it into the current conversation. Mirrors the console's seed dialog.
 */
export function AgentBuilderSeedDialog({
  open,
  prompt,
  onStartFresh,
  onContinue,
  onCancel,
}: {
  open: boolean;
  prompt: string;
  onStartFresh: () => void;
  onContinue: () => void;
  onCancel: () => void;
}) {
  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onCancel();
      }}
    >
      <AlertDialog.Content maxWidth="440px" size="2">
        <AlertDialog.Title className="text-base">
          <Flex align="center" gap="2">
            <SparkleIcon size={16} weight="fill" color="var(--accent-9)" />
            Start a new chat?
          </Flex>
        </AlertDialog.Title>
        <AlertDialog.Description className="text-sm">
          You have an Agent Builder chat in progress. Start a fresh chat for
          this, or continue the current one?
        </AlertDialog.Description>
        <Text className="mt-3 line-clamp-3 block rounded-(--radius-2) border border-(--gray-5) bg-(--gray-2) px-3 py-2 text-[12.5px] text-gray-11 italic">
          “{prompt}”
        </Text>

        <Flex justify="end" gap="2" mt="4">
          <Button variant="soft" color="gray" size="1" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="soft" size="1" onClick={onContinue}>
            Continue current chat
          </Button>
          <Button variant="solid" size="1" onClick={onStartFresh}>
            Start fresh
          </Button>
        </Flex>
      </AlertDialog.Content>
    </AlertDialog.Root>
  );
}
