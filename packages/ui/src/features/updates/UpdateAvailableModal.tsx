import { ArrowDown, ArrowsClockwise } from "@phosphor-icons/react";
import { useHostTRPC } from "@posthog/host-router/react";
import { MarkdownRenderer } from "@posthog/ui/features/editor/components/MarkdownRenderer";
import { useUpdateModalStore } from "@posthog/ui/features/updates/updateModalStore";
import {
  useInstallUpdate,
  useUpdateView,
} from "@posthog/ui/features/updates/updateStore";
import {
  Button,
  Code,
  Dialog,
  Flex,
  Progress,
  ScrollArea,
  Text,
} from "@radix-ui/themes";
import { useMutation, useQuery } from "@tanstack/react-query";

function formatSpeed(bytesPerSecond: number | null): string {
  if (!bytesPerSecond || bytesPerSecond <= 0) return "";
  return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
}

export function UpdateAvailableModal() {
  const isOpen = useUpdateModalStore((state) => state.isOpen);
  const close = useUpdateModalStore((state) => state.close);
  const {
    status,
    version,
    availableVersion,
    releaseNotes,
    downloadPercent,
    bytesPerSecond,
  } = useUpdateView();
  const installUpdate = useInstallUpdate();
  const hostTRPC = useHostTRPC();
  const { data: currentVersion } = useQuery(
    hostTRPC.os.getAppVersion.queryOptions(),
  );
  const downloadMutation = useMutation(
    hostTRPC.updates.download.mutationOptions(),
  );

  const targetVersion = version ?? availableVersion;
  const percent = Math.round(downloadPercent ?? 0);
  const isDownloading = status === "downloading";
  const isReady = status === "ready" || status === "installing";

  return (
    <Dialog.Root
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <Dialog.Content maxWidth="460px">
        <Flex direction="column" gap="3">
          <Flex direction="column" gap="1">
            <Dialog.Title className="mb-0">Update Available</Dialog.Title>
            <Dialog.Description>
              <Text color="gray" size="2">
                {targetVersion
                  ? `PostHog Code ${targetVersion} is ready`
                  : "A new version is ready"}
              </Text>
            </Dialog.Description>
          </Flex>

          {currentVersion ? (
            <Flex
              align="center"
              gap="2"
              className="rounded-3 border border-gray-5 bg-gray-2 px-3 py-2"
            >
              <Text size="2" color="gray">
                You're currently on version
              </Text>
              <Code variant="soft">{currentVersion}</Code>
            </Flex>
          ) : null}

          {releaseNotes ? (
            <Flex direction="column" gap="1">
              <Text size="2" weight="medium" color="gray">
                Release notes
              </Text>
              <ScrollArea
                type="auto"
                scrollbars="vertical"
                style={{ maxHeight: 240 }}
              >
                <div className="pr-3">
                  <MarkdownRenderer content={releaseNotes} />
                </div>
              </ScrollArea>
            </Flex>
          ) : null}

          {isDownloading ? (
            <Flex direction="column" gap="1">
              <Flex justify="between">
                <Text size="1" color="gray">
                  Downloading... {percent}%
                </Text>
                <Text size="1" color="gray">
                  {formatSpeed(bytesPerSecond)}
                </Text>
              </Flex>
              <Progress value={percent} size="2" />
            </Flex>
          ) : null}

          <Flex justify="end" align="center" gap="3" mt="1">
            <Button variant="ghost" color="gray" onClick={close}>
              Later
            </Button>
            {isReady ? (
              <Button onClick={() => void installUpdate()}>
                <ArrowsClockwise size={16} />
                Restart to update
              </Button>
            ) : isDownloading ? (
              <Button disabled>
                <ArrowsClockwise size={16} className="animate-spin" />
                Downloading...
              </Button>
            ) : (
              <Button onClick={() => downloadMutation.mutate(undefined)}>
                <ArrowDown size={16} />
                Download Update
              </Button>
            )}
          </Flex>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
