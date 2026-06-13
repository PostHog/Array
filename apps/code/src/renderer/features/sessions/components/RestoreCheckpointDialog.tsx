import { Button, Dialog, Flex, Text } from "@radix-ui/themes";

interface RestoreCheckpointDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  isLoading: boolean;
  /** True when the agent is mid-response; restoring will stop it. */
  isTurnInProgress?: boolean;
  /** True when the current session is a cloud task. */
  isCloud?: boolean;
}

export function RestoreCheckpointDialog({
  open,
  onOpenChange,
  onConfirm,
  isLoading,
  isTurnInProgress = false,
  isCloud = false,
}: RestoreCheckpointDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content maxWidth="420px" size="1">
        <Flex direction="column" gap="3" py="3">
          <Dialog.Title size="3" weight="medium" className="m-0">
            Restore checkpoint
          </Dialog.Title>
          <Text size="2" color="gray">
            {isCloud
              ? "This will revert all file changes made after this point. You'll need to continue the task locally to resume from here."
              : `This will revert all file changes made after this point. This action cannot be undone.${
                  isTurnInProgress
                    ? " The agent is still responding — restoring will stop the current response."
                    : ""
                }`}
          </Text>
          <Flex gap="2" justify="end">
            <Dialog.Close>
              <Button
                variant="soft"
                color="gray"
                disabled={isLoading}
                className="min-w-20 justify-center"
              >
                Cancel
              </Button>
            </Dialog.Close>
            <Button
              color="red"
              disabled={isLoading}
              loading={isLoading}
              onClick={onConfirm}
              className="min-w-20 justify-center"
            >
              Restore
            </Button>
          </Flex>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
