import { GitDialog } from "@features/git-interaction/components/GitInteractionDialogs";
import { ArrowCounterClockwise } from "@phosphor-icons/react";
import { Text } from "@radix-ui/themes";

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
    <GitDialog
      open={open}
      onOpenChange={onOpenChange}
      icon={<ArrowCounterClockwise size={14} />}
      title="Restore checkpoint"
      error={null}
      buttonLabel="Restore"
      buttonColor="red"
      isSubmitting={isLoading}
      onSubmit={onConfirm}
    >
      <Text color="gray" className="text-[13px]">
        {isCloud
          ? "This will revert all file changes made after this point. You'll need to continue the task locally to resume from here."
          : `This will revert all file changes made after this point. This action cannot be undone.${
              isTurnInProgress
                ? " The agent is still responding — restoring will stop the current response."
                : ""
            }`}
      </Text>
    </GitDialog>
  );
}
