import { SignalSourcesSettings } from "@features/settings/components/sections/SignalSourcesSettings";
import { XIcon } from "@phosphor-icons/react";
import { Button, Dialog, Flex, Tooltip } from "@radix-ui/themes";

interface InboxSourcesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hasSignalSources: boolean;
  hasGithubIntegration: boolean;
}

export function InboxSourcesDialog({
  open,
  onOpenChange,
  hasSignalSources,
  hasGithubIntegration,
}: InboxSourcesDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content maxWidth="800px">
        <Flex align="center" justify="between" mb="3">
          <Dialog.Title mb="0" className="text-base">
            Inbox configuration
          </Dialog.Title>
          <Dialog.Close>
            <button
              type="button"
              className="rounded p-1 text-gray-11 hover:bg-gray-3 hover:text-gray-12"
              aria-label="Close"
            >
              <XIcon size={16} />
            </button>
          </Dialog.Close>
        </Flex>
        <SignalSourcesSettings />
        <Flex justify="end" mt="4">
          {hasSignalSources && hasGithubIntegration ? (
            <Dialog.Close>
              <Button size="2">Back to Inbox</Button>
            </Dialog.Close>
          ) : (
            <Tooltip
              content={
                !hasGithubIntegration
                  ? "Connect GitHub to get started!"
                  : "You haven't enabled any signal source yet!"
              }
            >
              <Button size="2" disabled>
                Back to Inbox
              </Button>
            </Tooltip>
          )}
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
