import { FileTextIcon, HashIcon } from "@phosphor-icons/react";
import { FolderInstructionsConflictError } from "@posthog/api-client/posthog-client";
import { useChannels } from "@posthog/ui/features/canvas/hooks/useChannels";
import {
  useFolderInstructions,
  useFolderInstructionsMutations,
  useFolderInstructionsVersions,
} from "@posthog/ui/features/canvas/hooks/useFolderInstructions";
import { MarkdownRenderer } from "@posthog/ui/features/editor/components/MarkdownRenderer";
import { useSetHeaderContent } from "@posthog/ui/hooks/useSetHeaderContent";
import {
  Box,
  Button,
  Callout,
  Flex,
  ScrollArea,
  SegmentedControl,
  Select,
  Spinner,
  Text,
  TextArea,
} from "@radix-ui/themes";
import { useEffect, useMemo, useState } from "react";

type Mode = "rendered" | "edit";

// Initial markdown shown when a folder has no instructions yet — gives both
// humans and agents a structural starting point instead of a blank screen.
const EMPTY_TEMPLATE = "# Folder context\n\nDescribe what lives here.\n";

interface WebsiteContextProps {
  channelId: string;
}

export function WebsiteContext({ channelId }: WebsiteContextProps) {
  // Resolve the channel name from the cached channels list, so we don't make
  // a second network call just for the header label.
  const { channels } = useChannels();
  const channel = useMemo(
    () => channels.find((c) => c.id === channelId) ?? null,
    [channels, channelId],
  );

  const {
    data: latest,
    isLoading: isLoadingLatest,
    isFetching: isFetchingLatest,
    error: latestError,
  } = useFolderInstructions(channelId);

  const { data: versions = [], isLoading: isLoadingVersions } =
    useFolderInstructionsVersions(channelId);

  const { publish, isPublishing, publishError } =
    useFolderInstructionsMutations(channelId);

  const [mode, setMode] = useState<Mode>("rendered");
  const [draft, setDraft] = useState("");
  const [hasDraft, setHasDraft] = useState(false);

  // Seed the editor draft from the latest content the first time we land on
  // edit mode (or whenever latest changes while we're not actively editing).
  // We don't blow away an in-flight edit just because the cache refetched.
  useEffect(() => {
    if (hasDraft) return;
    setDraft(latest?.content ?? "");
  }, [latest?.content, hasDraft]);

  const channelName = channel?.name ?? "Channel";
  const headerContent = useMemo(
    () => (
      <Flex align="center" gap="2" className="w-full min-w-0">
        <HashIcon size={12} className="shrink-0 text-gray-10" />
        <Text
          className="truncate whitespace-nowrap font-medium text-[13px]"
          title={channelName}
        >
          {channelName}
        </Text>
        <Text className="shrink-0 text-[13px] text-gray-9">/</Text>
        <FileTextIcon size={12} className="shrink-0 text-gray-10" />
        <Text className="shrink-0 whitespace-nowrap text-[13px] text-gray-11">
          CONTEXT.md
        </Text>
      </Flex>
    ),
    [channelName],
  );
  useSetHeaderContent(headerContent);

  const onSave = async () => {
    try {
      await publish({
        content: draft,
        // base_version=0 signals "no prior version" to the optimistic
        // concurrency check; otherwise we send the version we started from.
        baseVersion: latest?.version ?? 0,
      });
      setHasDraft(false);
      setMode("rendered");
    } catch {
      // Errors surface through `publishError` below; nothing to do here.
    }
  };

  const isConflict = publishError instanceof FolderInstructionsConflictError;

  // Allow inspecting an older version read-only. When `null`, we're showing
  // either the latest (rendered/edit) or the empty state.
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    null,
  );

  // Picking a past version forces rendered mode and shows that version's
  // metadata; we don't currently fetch the historical content body, so the
  // viewer falls back to "Open latest in editor" when there is no body.
  // (Backend exposes content only via the `latest` endpoint today.)
  const selectedVersion = useMemo(() => {
    if (!selectedVersionId) return null;
    return versions.find((v) => v.id === selectedVersionId) ?? null;
  }, [selectedVersionId, versions]);

  if (isLoadingLatest) {
    return (
      <Flex align="center" justify="center" className="h-full">
        <Spinner size="2" />
      </Flex>
    );
  }

  if (latestError) {
    return (
      <Flex direction="column" gap="3" p="4">
        <Callout.Root color="red" size="1">
          <Callout.Text>
            Failed to load folder instructions: {latestError.message}
          </Callout.Text>
        </Callout.Root>
      </Flex>
    );
  }

  // Treat `null` (404: never published), `undefined` (query disabled), AND a
  // row with whitespace-only content as "no instructions" so we render the
  // empty state — otherwise MarkdownRenderer paints an invisible empty block
  // and the page looks blank.
  const renderedContent = latest?.content ?? "";
  const hasInstructions = renderedContent.trim().length > 0;

  return (
    <Flex direction="column" height="100%" className="overflow-hidden">
      <Flex
        align="center"
        justify="between"
        gap="3"
        px="4"
        py="2"
        className="shrink-0 border-b border-b-(--gray-5)"
      >
        <Flex align="center" gap="3">
          <SegmentedControl.Root
            value={mode}
            onValueChange={(value) => setMode(value as Mode)}
            size="1"
          >
            <SegmentedControl.Item value="rendered">
              Rendered
            </SegmentedControl.Item>
            <SegmentedControl.Item value="edit">Edit</SegmentedControl.Item>
          </SegmentedControl.Root>

          {/* Background-refetch indicator: the initial load uses the full-screen
              spinner below; this only fires on revalidations (every mount, plus
              after publish/delete invalidations) so the user knows the view is
              live and not just stale cache. */}
          {isFetchingLatest && !isLoadingLatest ? (
            <Flex align="center" gap="1">
              <Spinner size="1" />
              <Text className="text-[12px] text-gray-10">Refreshing…</Text>
            </Flex>
          ) : null}

          {versions.length > 0 ? (
            <Select.Root
              size="1"
              value={selectedVersionId ?? "latest"}
              onValueChange={(value) => {
                if (value === "latest") {
                  setSelectedVersionId(null);
                } else {
                  setSelectedVersionId(value);
                  setMode("rendered");
                }
              }}
              disabled={isLoadingVersions}
            >
              <Select.Trigger />
              <Select.Content>
                <Select.Item value="latest">
                  Latest (v{latest?.version ?? "—"})
                </Select.Item>
                {versions
                  .filter((v) => !v.is_latest)
                  .map((v) => (
                    <Select.Item key={v.id} value={v.id}>
                      v{v.version} · {formatTimestamp(v.created_at)}
                    </Select.Item>
                  ))}
              </Select.Content>
            </Select.Root>
          ) : null}
        </Flex>

        {mode === "edit" ? (
          <Flex align="center" gap="2">
            {hasDraft ? (
              <Button
                size="1"
                variant="soft"
                color="gray"
                onClick={() => {
                  setDraft(latest?.content ?? "");
                  setHasDraft(false);
                }}
                disabled={isPublishing}
              >
                Discard
              </Button>
            ) : null}
            <Button
              size="1"
              variant="solid"
              onClick={onSave}
              disabled={
                isPublishing ||
                (hasInstructions ? !hasDraft : draft.trim().length === 0)
              }
            >
              {isPublishing ? <Spinner size="1" /> : null}
              Save new version
            </Button>
          </Flex>
        ) : null}
      </Flex>

      {publishError ? (
        <Box px="4" pt="3">
          <Callout.Root color={isConflict ? "amber" : "red"} size="1">
            <Callout.Text>
              {isConflict
                ? "Someone else saved a newer version. Reload to merge your changes."
                : `Save failed: ${publishError.message}`}
            </Callout.Text>
          </Callout.Root>
        </Box>
      ) : null}

      <ScrollArea
        type="auto"
        scrollbars="vertical"
        className="scroll-area-constrain-width min-h-0 flex-1"
      >
        <Box p="4">
          {selectedVersion ? (
            <Callout.Root color="gray" size="1">
              <Callout.Text>
                Viewing v{selectedVersion.version} metadata. Past content is not
                fetched today — switch to "Latest" to read or edit current
                content.
              </Callout.Text>
            </Callout.Root>
          ) : mode === "rendered" ? (
            hasInstructions ? (
              <Box className="text-[13px]">
                <MarkdownRenderer content={renderedContent} />
              </Box>
            ) : (
              <EmptyState
                channelName={channelName}
                onCreate={() => {
                  setDraft(EMPTY_TEMPLATE);
                  setHasDraft(true);
                  setMode("edit");
                }}
              />
            )
          ) : (
            <TextArea
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setHasDraft(true);
              }}
              size="2"
              rows={24}
              placeholder={
                "# Folder context\n\nWrite markdown describing this folder…"
              }
              className="font-[var(--code-font-family)]"
            />
          )}
        </Box>
      </ScrollArea>
    </Flex>
  );
}

function EmptyState({
  channelName,
  onCreate,
}: {
  channelName: string;
  onCreate: () => void;
}) {
  return (
    <Flex
      direction="column"
      align="center"
      gap="4"
      className="mx-auto max-w-[440px] py-16 text-center"
    >
      <Box className="rounded-lg border border-gray-6 border-dashed p-4">
        <FileTextIcon size={28} className="text-gray-8" />
      </Box>
      <Flex direction="column" gap="2" align="center">
        <Text className="font-medium text-[14px] text-gray-12">
          No CONTEXT.md yet
        </Text>
        <Text className="text-[13px] text-gray-10 leading-relaxed">
          CONTEXT.md tells agents the specific details they need to know when
          working in <strong>{channelName}</strong> — conventions, gotchas, key
          files, and anything else that isn't obvious from the code.
        </Text>
      </Flex>
      <Button size="2" variant="solid" onClick={onCreate}>
        Create CONTEXT.md
      </Button>
    </Flex>
  );
}

// `created_at` is an ISO timestamp; we render it as a short local string for
// the version dropdown. Falls back to the raw string if Date parsing fails.
function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
