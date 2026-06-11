import {
  FileTextIcon,
  HashIcon,
  SparkleIcon,
  SpinnerGapIcon,
} from "@phosphor-icons/react";
import { FolderInstructionsConflictError } from "@posthog/api-client/posthog-client";
import { useHostTRPC } from "@posthog/host-router/react";
import { buildContextSystemPrompt } from "@posthog/ui/features/canvas/contextPrompt";
import { registerContextSubscription } from "@posthog/ui/features/canvas/contextSubscriptions";
import { useChannels } from "@posthog/ui/features/canvas/hooks/useChannels";
import {
  useFolderInstructions,
  useFolderInstructionsMutations,
  useFolderInstructionsVersions,
} from "@posthog/ui/features/canvas/hooks/useFolderInstructions";
import {
  useContextGenChannel,
  useContextGenStore,
} from "@posthog/ui/features/canvas/stores/contextGenStore";
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
import { useQuery } from "@tanstack/react-query";
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
    refetch: refetchLatest,
  } = useFolderInstructions(channelId);

  const { data: versions = [], isLoading: isLoadingVersions } =
    useFolderInstructionsVersions(channelId);

  const { publish, isPublishing, publishError } =
    useFolderInstructionsMutations(channelId);

  const [mode, setMode] = useState<Mode>("rendered");
  const [draft, setDraft] = useState("");
  const [hasDraft, setHasDraft] = useState(false);

  // Agent CONTEXT.md generation. The subscription streams the agent's progress
  // into the context-gen store while this view is mounted; the agent publishes
  // the document itself via the PostHog MCP, so on completion we just refetch.
  const gen = useContextGenChannel(channelId);
  const resetGen = useContextGenStore((s) => s.reset);
  useEffect(() => registerContextSubscription(channelId), [channelId]);
  useEffect(() => {
    if (gen.status !== "done") return;
    void refetchLatest();
    setMode("rendered");
    resetGen(channelId);
  }, [gen.status, channelId, refetchLatest, resetGen]);

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
          {gen.status === "running" ? (
            <GeneratingPanel
              proseBuffer={gen.proseBuffer}
              activeTool={gen.activeTool}
            />
          ) : selectedVersion ? (
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
                channelId={channelId}
                channelName={channelName}
                baseVersion={latest?.version ?? 0}
                generationError={gen.status === "error" ? gen.error : null}
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
  channelId,
  channelName,
  baseVersion,
  generationError,
  onCreate,
}: {
  channelId: string;
  channelName: string;
  baseVersion: number;
  generationError: string | null;
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

      {generationError ? (
        <Callout.Root color="red" size="1" className="w-full text-left">
          <Callout.Text>Generation failed: {generationError}</Callout.Text>
        </Callout.Root>
      ) : null}

      <Flex align="center" gap="3">
        <Button size="2" variant="solid" onClick={onCreate}>
          Create CONTEXT.md
        </Button>
        <GenerateWithAgent
          channelId={channelId}
          channelName={channelName}
          baseVersion={baseVersion}
        />
      </Flex>
    </Flex>
  );
}

// Lets the user pick an already-registered local repo and kick off the agent
// that explores it (plus PostHog data) and publishes CONTEXT.md via the MCP.
function GenerateWithAgent({
  channelId,
  channelName,
  baseVersion,
}: {
  channelId: string;
  channelName: string;
  baseVersion: number;
}) {
  const trpc = useHostTRPC();
  const { data: folders = [], isLoading } = useQuery(
    trpc.folders.getFolders.queryOptions(),
  );
  const start = useContextGenStore((s) => s.start);

  const [picking, setPicking] = useState(false);
  const [repoPath, setRepoPath] = useState<string | null>(null);

  // Only repos that still exist on disk are explorable. Default to the first
  // (getFolders returns most-recently-used first) so the common case is 1 click.
  const available = useMemo(() => folders.filter((f) => f.exists), [folders]);
  const selected = repoPath ?? available[0]?.path ?? null;

  if (!picking) {
    return (
      <Button
        size="2"
        variant="soft"
        onClick={() => setPicking(true)}
        disabled={isLoading}
      >
        <SparkleIcon size={14} />
        Generate with agent
      </Button>
    );
  }

  if (available.length === 0) {
    return (
      <Text className="text-[12px] text-gray-10">
        No local repositories registered — open a folder first.
      </Text>
    );
  }

  return (
    <Flex align="center" gap="2">
      <Select.Root
        size="2"
        value={selected ?? undefined}
        onValueChange={setRepoPath}
      >
        <Select.Trigger placeholder="Select a repository…" />
        <Select.Content>
          {available.map((f) => (
            <Select.Item key={f.id} value={f.path}>
              {f.name}
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Root>
      <Button
        size="2"
        variant="solid"
        disabled={!selected}
        onClick={() => {
          if (!selected) return;
          void start({
            channelId,
            channelName,
            repoPath: selected,
            systemPrompt: buildContextSystemPrompt({
              channelName,
              channelId,
              baseVersion,
            }),
          });
        }}
      >
        <SparkleIcon size={14} />
        Generate
      </Button>
    </Flex>
  );
}

// Live view of the agent's progress: the current tool call plus the markdown it
// has streamed so far. Replaced by the rendered CONTEXT.md once it publishes.
function GeneratingPanel({
  proseBuffer,
  activeTool,
}: {
  proseBuffer: string;
  activeTool: string | null;
}) {
  return (
    <Flex direction="column" gap="3">
      <Flex align="center" gap="2" className="text-gray-10">
        <SpinnerGapIcon size={14} className="animate-spin" />
        <Text className="text-[13px]">
          {activeTool ?? "Generating CONTEXT.md…"}
        </Text>
      </Flex>
      {proseBuffer.trim().length > 0 ? (
        <Box className="text-[13px]">
          <MarkdownRenderer content={proseBuffer} />
        </Box>
      ) : null}
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
