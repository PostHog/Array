import { EXTERNAL_LINKS } from "@posthog/shared";
import { Button } from "@posthog/ui/primitives/Button";
import { openExternalUrl } from "@posthog/ui/shell/openExternal";
import { Flex, Spinner, Text } from "@radix-ui/themes";
import { useEffect, useState } from "react";

// Sits above the core bootstrap deadline so this only shows once boot has truly given up.
const STALL_TIMEOUT_MS = 25_000;

export function BootstrapFallback(): React.ReactNode {
  const [stalled, setStalled] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setStalled(true), STALL_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, []);

  if (!stalled) {
    return (
      <Flex align="center" justify="center" minHeight="100vh">
        <Flex align="center" gap="3">
          <Spinner size="3" />
          <Text color="gray">Loading...</Text>
        </Flex>
      </Flex>
    );
  }

  return (
    <Flex align="center" justify="center" minHeight="100vh">
      <Flex
        direction="column"
        align="center"
        gap="4"
        className="max-w-[360px] text-center"
      >
        <Text size="4" weight="bold">
          PostHog is taking longer than expected to start
        </Text>
        <Text color="gray">This usually clears up with a restart.</Text>
        <Flex gap="3">
          <Button onClick={() => window.location.reload()}>Retry</Button>
          <Button
            variant="soft"
            onClick={() => openExternalUrl(EXTERNAL_LINKS.discord)}
          >
            Get support
          </Button>
        </Flex>
      </Flex>
    </Flex>
  );
}
