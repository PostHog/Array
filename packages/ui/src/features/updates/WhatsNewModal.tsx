import { X } from "@phosphor-icons/react";
import { useHostTRPC } from "@posthog/host-router/react";
import {
  groupReleases,
  mergeReleaseNotes,
} from "@posthog/ui/features/updates/releaseNotes";
import { useWhatsNewStore } from "@posthog/ui/features/updates/whatsNewStore";
import {
  Badge,
  Dialog,
  Flex,
  IconButton,
  ScrollArea,
  Skeleton,
  Text,
} from "@radix-ui/themes";
import { useQuery } from "@tanstack/react-query";

function ReleaseSection({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <Flex direction="column" gap="1">
      <span className="font-medium text-[11px] text-gray-10 uppercase tracking-wide">
        {title}
      </span>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {items.map((item) => (
          <li
            key={`${title}-${item}`}
            className="flex gap-2 text-[13px] text-gray-12 leading-relaxed"
          >
            <span className="mt-px select-none text-gray-9">•</span>
            <span className="min-w-0">{item}</span>
          </li>
        ))}
      </ul>
    </Flex>
  );
}

function ChangelogSkeleton() {
  return (
    <Flex direction="column" gap="5">
      {["a", "b", "c"].map((key) => (
        <Flex key={key} direction="column" gap="3">
          <Flex align="center" justify="between" gap="2">
            <Skeleton width="150px" height="22px" />
            <Skeleton width="72px" height="22px" />
          </Flex>
          <Flex direction="column" gap="2">
            <Skeleton width="64px" height="12px" />
            <Skeleton width="82%" height="14px" />
            <Skeleton width="68%" height="14px" />
            <Skeleton width="74%" height="14px" />
          </Flex>
        </Flex>
      ))}
    </Flex>
  );
}

export function WhatsNewModal() {
  const isOpen = useWhatsNewStore((state) => state.isOpen);
  const close = useWhatsNewStore((state) => state.close);
  const hostTRPC = useHostTRPC();
  const { data, isLoading, isError } = useQuery({
    ...hostTRPC.githubReleases.list.queryOptions(),
    enabled: isOpen,
  });
  const { data: currentVersion } = useQuery(
    hostTRPC.os.getAppVersion.queryOptions(),
  );

  const groups = groupReleases(data?.releases ?? []);

  return (
    <Dialog.Root
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <Dialog.Content maxWidth="640px">
        <Flex justify="between" align="start" gap="3" mb="3">
          <Flex direction="column" gap="1">
            <Dialog.Title className="mb-0">What's New</Dialog.Title>
            <Dialog.Description>
              <Text color="gray" size="2">
                Release history and recent improvements
              </Text>
            </Dialog.Description>
          </Flex>
          <Dialog.Close>
            <IconButton variant="ghost" color="gray" aria-label="Close">
              <X size={16} />
            </IconButton>
          </Dialog.Close>
        </Flex>

        {isLoading ? (
          <ChangelogSkeleton />
        ) : isError ? (
          <Text color="gray" size="2">
            Could not load releases. Please try again later.
          </Text>
        ) : groups.length === 0 ? (
          <Text color="gray" size="2">
            No releases found.
          </Text>
        ) : (
          <ScrollArea
            type="scroll"
            scrollbars="vertical"
            style={{ maxHeight: "60vh" }}
          >
            <Flex direction="column" gap="5" className="pr-3">
              {groups.map((group, index) => {
                const { improved, fixed } = mergeReleaseNotes(group.releases);
                const containsCurrent = currentVersion
                  ? group.releases.some(
                      (release) => release.version === currentVersion,
                    )
                  : false;
                return (
                  <Flex
                    key={group.key}
                    direction="column"
                    gap="3"
                    className={
                      index > 0 ? "border-gray-6 border-t pt-5" : undefined
                    }
                  >
                    <Flex align="center" justify="between" gap="2">
                      <Text weight="bold" size="3">
                        {group.label}
                      </Text>
                      <Flex align="center" gap="2">
                        {group.isLatest ? (
                          <Badge color="green">Latest</Badge>
                        ) : null}
                        {containsCurrent ? (
                          <Badge color="gray" variant="outline">
                            Current
                          </Badge>
                        ) : null}
                        <Badge color="gray" variant="soft">
                          {group.releases.length === 1
                            ? group.releases[0].name
                            : `${group.releases.length} releases`}
                        </Badge>
                      </Flex>
                    </Flex>
                    {improved.length === 0 && fixed.length === 0 ? (
                      <Text size="2" color="gray">
                        No notable changes.
                      </Text>
                    ) : (
                      <Flex direction="column" gap="3">
                        <ReleaseSection title="Improved" items={improved} />
                        <ReleaseSection title="Fixed" items={fixed} />
                      </Flex>
                    )}
                  </Flex>
                );
              })}
            </Flex>
          </ScrollArea>
        )}
      </Dialog.Content>
    </Dialog.Root>
  );
}
