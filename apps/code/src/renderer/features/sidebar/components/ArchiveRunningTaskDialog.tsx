import { Warning } from "@phosphor-icons/react";
import { AlertDialog, Button, Flex } from "@radix-ui/themes";

interface ArchiveRunningTaskDialogProps {
  open: boolean;
  taskTitle: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ArchiveRunningTaskDialog({
  open,
  taskTitle,
  onConfirm,
  onCancel,
}: ArchiveRunningTaskDialogProps) {
  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onCancel();
      }}
    >
      <AlertDialog.Content maxWidth="420px" size="2">
        <AlertDialog.Title className="text-base">
          <Flex align="center" gap="2">
            <Warning size={18} weight="fill" color="var(--orange-9)" />
            Archive running task?
          </Flex>
        </AlertDialog.Title>
        <AlertDialog.Description className="text-sm">
          {taskTitle ? `"${taskTitle}"` : "This task"} is still running.
          Archiving it now will stop the agent. You can unarchive it later.
        </AlertDialog.Description>

        <Flex justify="end" gap="2" mt="4">
          <AlertDialog.Cancel>
            <Button variant="soft" color="gray" size="1">
              Cancel
            </Button>
          </AlertDialog.Cancel>
          <AlertDialog.Action>
            <Button variant="solid" size="1" onClick={onConfirm}>
              Archive
            </Button>
          </AlertDialog.Action>
        </Flex>
      </AlertDialog.Content>
    </AlertDialog.Root>
  );
}
