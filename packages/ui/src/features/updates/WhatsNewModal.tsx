import { useHostTRPC } from "@posthog/host-router/react";
import { MarkdownRenderer } from "@posthog/ui/features/editor/components/MarkdownRenderer";
import { useWhatsNewStore } from "@posthog/ui/features/updates/whatsNewStore";
import {
  Badge,
  Dialog,
  Flex,
  ScrollArea,
  Spinner,
  Text,
} from "@radix-ui/themes";
import { useQuery } from "@tanstack/react-query";

function formatDate(date: string | null): string {
  if (!date) return "";
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function WhatsNewModal() {
  const isOpen = useWhatsNewStore((state) => state.isOpen);
  const close = useWhatsNewStore((state) => state.close);
  const hostTRPC = useHostTRPC();
  const { data, isLoading, isError, error } = useQuery({
    ...hostTRPC.githubReleases.list.queryOptions(),
    enabled: isOpen,
  });
  const { data: currentVersion } = useQuery(
    hostTRPC.os.getAppVersion.queryOptions(),
  );

  const releases = data?.releases ?? [];

  return (
    <Dialog.Root
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <Dialog.Content maxWidth="640px">
        <Flex direction="column" gap="1" mb="3">
          <Dialog.Title className="mb-0">What's New</Dialog.Title>
          <Dialog.Description>
            <Text color="gray" size="2">
              Release history and recent improvements
            </Text>
          </Dialog.Description>
        </Flex>

        {isLoading ? (
          <Flex align="center" justify="center" py="6">
            <Spinner />
          </Flex>
        ) : isError ? (
          <Text color="gray" size="2">
            Could not load releases:{" "}
            {error instanceof Error ? error.message : String(error)}
          </Text>
        ) : releases.length === 0 ? (
          <Text color="gray" size="2">
            No releases found.
          </Text>
        ) : (
          <ScrollArea
            type="auto"
            scrollbars="vertical"
            style={{ maxHeight: "60vh" }}
          >
            <Flex direction="column" gap="5" className="pr-3">
              {releases.map((release, index) => (
                <Flex key={release.version} direction="column" gap="2">
                  <Flex align="center" justify="between" gap="2">
                    <Flex align="center" gap="2">
                      <Text weight="bold" size="3">
                        {release.name}
                      </Text>
                      {index === 0 ? <Badge color="green">Latest</Badge> : null}
                      {currentVersion === release.version ? (
                        <Badge color="gray" variant="soft">
                          Current
                        </Badge>
                      ) : null}
                    </Flex>
                    <Text size="1" color="gray">
                      {formatDate(release.date)}
                    </Text>
                  </Flex>
                  {release.notes ? (
                    <MarkdownRenderer content={release.notes} />
                  ) : (
                    <Text size="2" color="gray">
                      No release notes.
                    </Text>
                  )}
                </Flex>
              ))}
            </Flex>
          </ScrollArea>
        )}
      </Dialog.Content>
    </Dialog.Root>
  );
}
