import { Button, Dialog, Flex, Text } from "@radix-ui/themes";
import { useCallback, useEffect, useState } from "react";

export function UpdatePrompt() {
  const [open, setOpen] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = window.electronAPI?.onUpdateReady(() => {
      setErrorMessage(null);
      setOpen(true);
    });

    return () => {
      unsubscribe?.();
    };
  }, []);

  const handleRestart = useCallback(async () => {
    if (!window.electronAPI || isInstalling) {
      return;
    }

    setIsInstalling(true);
    setErrorMessage(null);

    try {
      const result = await window.electronAPI.installUpdate();
      if (!result?.installed) {
        setErrorMessage(
          "Couldn't restart automatically. Please quit and relaunch manually.",
        );
        setIsInstalling(false);
      }
      // When installed === true the app will quit immediately.
    } catch (error) {
      console.error("[updates] Failed to install update", error);
      setErrorMessage("Update failed to install. Try quitting manually.");
      setIsInstalling(false);
    }
  }, [isInstalling]);

  if (!open) {
    return null;
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Content maxWidth="360px">
        <Flex direction="column" gap="3">
          <Dialog.Title className="mb-0">Update ready</Dialog.Title>
          <Dialog.Description>
            A new version of Array has finished downloading. Restart now to
            install it or choose Later to keep working and update next time.
          </Dialog.Description>
          {errorMessage ? (
            <Text size="2" color="red">
              {errorMessage}
            </Text>
          ) : null}
          <Flex justify="end" gap="3" mt="2">
            <Button
              type="button"
              variant="soft"
              color="gray"
              onClick={() => setOpen(false)}
              disabled={isInstalling}
            >
              Later
            </Button>
            <Button
              type="button"
              onClick={handleRestart}
              disabled={isInstalling}
            >
              {isInstalling ? "Restarting…" : "Restart now"}
            </Button>
          </Flex>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
