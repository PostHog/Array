import { useUsageLimitStore } from "@features/billing/stores/usageLimitStore";
import { useSettingsDialogStore } from "@features/settings/stores/settingsDialogStore";
import { WarningCircle } from "@phosphor-icons/react";
import { Button, Dialog, Flex, Text } from "@radix-ui/themes";

export function UsageLimitModal() {
  const isOpen = useUsageLimitStore((s) => s.isOpen);
  const hide = useUsageLimitStore((s) => s.hide);

  const handleUpgrade = () => {
    hide();
    useSettingsDialogStore.getState().open("plan-usage");
  };

  return (
    <Dialog.Root open={isOpen}>
      <Dialog.Content
        maxWidth="400px"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={hide}
      >
        <Flex direction="column" gap="3">
          <Flex align="center" gap="2">
            <WarningCircle size={20} weight="bold" color="var(--red-9)" />
            <Dialog.Title className="mb-0">
              You're out of usage for this month
            </Dialog.Title>
          </Flex>
          <Dialog.Description>
            <Text color="gray" className="text-sm">
              Free includes $50 of Claude and Codex usage per month. Pro
              includes $1,000 of usage for $200/month — 20× more than Free.
            </Text>
          </Dialog.Description>
          <Flex justify="end" gap="3" mt="2">
            <Button type="button" variant="soft" color="gray" onClick={hide}>
              Not now
            </Button>
            <Button type="button" onClick={handleUpgrade}>
              See Pro
            </Button>
          </Flex>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
