import { ArrowCounterClockwise, Warning } from "@phosphor-icons/react";
import { Button, Dialog, Flex, Text } from "@radix-ui/themes";

interface RestoreCheckpointDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  isLoading: boolean;
}

export function RestoreCheckpointDialog({
  open,
  onOpenChange,
  onConfirm,
  isLoading,
}: RestoreCheckpointDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content maxWidth="420px" size="1">
        <Flex direction="column" gap="3">
          <Flex align="center" gap="2">
            <ArrowCounterClockwise size={16} className="text-(--amber-9)" />
            <Dialog.Title size="3" weight="medium" className="m-0">
              Restore checkpoint
            </Dialog.Title>
          </Flex>
          <Flex gap="2" align="start" className="rounded-(--radius-2) bg-(--amber-2) p-2">
            <Warning size={16} className="mt-0.5 shrink-0 text-(--amber-9)" />
            <Text size="2" color="gray">
              This will revert all file changes made after this point. This
              action cannot be undone.
            </Text>
          </Flex>
          <Flex gap="2" justify="end">
            <Dialog.Close>
              <Button variant="soft" color="gray" disabled={isLoading}>
                Cancel
              </Button>
            </Dialog.Close>
            <Button
              color="red"
              disabled={isLoading}
              loading={isLoading}
              onClick={onConfirm}
            >
              <ArrowCounterClockwise size={14} />
              Restore
            </Button>
          </Flex>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
