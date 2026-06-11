import {
  FileTextIcon,
  HashIcon,
  SparkleIcon,
  SpinnerGapIcon,
} from "@phosphor-icons/react";
import { FolderInstructionsConflictError } from "@posthog/api-client/posthog-client";
import { useHostTRPC } from "@posthog/host-router/react";
import { useChannels } from "@posthog/ui/features/canvas/hooks/useChannels";
import {
  useFolderInstructions,
  useFolderInstructionsMutations,
  useFolderInstructionsVersions,
} from "@posthog/ui/features/canvas/hooks/useFolderInstructions";
import { useGenerateContext } from "@posthog/ui/features/canvas/hooks/useGenerateContext";
import {
  useContextGenTaskId,
  useContextGenTaskStore,
} from "@posthog/ui/features/canvas/stores/contextGenTaskStore";
import { MarkdownRenderer } from "@posthog/ui/features/editor/components/MarkdownRenderer";
import { useSessionForTask } from "@posthog/ui/features/sessions/useSession";
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
import { Link } from "@tanstack/react-router";
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

  const hasInstructions = (latest?.content ?? "").trim().length > 0;

  // CONTEXT.md generation runs as a normal task in the channel's repo. It's
  // "generating" only while that task's agent session is actively running — if
  // it's stopped (by the user or otherwise) we fall back to the generate
  // screen. We record the task when we start it, so its session exists by then.
  const genTaskId = useContextGenTaskId(channelId);
  const clearGenTask = useContextGenTaskStore((s) => s.clearTask);
  const genSession = useSessionForTask(genTaskId);
  const sessionActive =
    genSession?.status === "connecting" || genSession?.status === "connected";

  const pollGen = !!genTaskId && !hasInstructions;
  const isGenerating = pollGen && sessionActive;
  const isStopped = pollGen && !sessionActive;

  // While the agent runs, poll the published file so it shows up without a
  // manual refresh once the agent publishes via the MCP.
  useEffect(() => {
    if (!isGenerating) return;
    const id = setInterval(() => void refetchLatest(), 5000);
    return () => clearInterval(id);
  }, [isGenerating, refetchLatest]);

  // The agent publishes mid-run, just before its session ends — so when the
  // session goes inactive, refetch once to catch a just-published file before
  // concluding the run stopped without producing one.
  useEffect(() => {
    if (pollGen && !sessionActive) void refetchLatest();
  }, [pollGen, sessionActive, refetchLatest]);

  // Once the file exists, the generation task has served its purpose — forget it
  // so we stop tracking status and just render the document.
  useEffect(() => {
    if (genTaskId && hasInstructions) clearGenTask(channelId);
  }, [genTaskId, hasInstructions, channelId, clearGenTask]);

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
          {isGenerating && genTaskId ? (
            <GeneratingState channelId={channelId} taskId={genTaskId} />
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
                stoppedTaskId={isStopped ? genTaskId : null}
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
  stoppedTaskId,
  onCreate,
}: {
  channelId: string;
  channelName: string;
  /** A prior generation task that stopped without producing a file, if any. */
  stoppedTaskId: string | null;
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

      {stoppedTaskId ? (
        <Callout.Root color="amber" size="1" className="w-full text-left">
          <Callout.Text>
            The previous generation in task{" "}
            <Link
              to="/website/$channelId/tasks/$taskId"
              params={{ channelId, taskId: stoppedTaskId }}
              className="font-medium text-amber-11 underline"
            >
              {shortTaskId(stoppedTaskId)}
            </Link>{" "}
            stopped before writing a CONTEXT.md. You can generate again.
          </Callout.Text>
        </Callout.Root>
      ) : null}

      <Flex align="center" gap="3">
        <Button size="2" variant="solid" onClick={onCreate}>
          Create CONTEXT.md
        </Button>
        <GenerateWithAgent
          channelId={channelId}
          channelName={channelName}
          regenerate={!!stoppedTaskId}
        />
      </Flex>
    </Flex>
  );
}

// Lets the user pick an already-registered local repo, then kicks off a normal
// task in it that explores the code + PostHog data and publishes CONTEXT.md.
function GenerateWithAgent({
  channelId,
  channelName,
  regenerate,
}: {
  channelId: string;
  channelName: string;
  regenerate: boolean;
}) {
  const trpc = useHostTRPC();
  const { data: folders = [], isLoading } = useQuery(
    trpc.folders.getFolders.queryOptions(),
  );
  const { generate, isStarting } = useGenerateContext(channelId, channelName);

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
        {regenerate ? "Generate again" : "Generate with agent"}
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
        disabled={!selected || isStarting}
        onClick={() => {
          if (selected) void generate(selected);
        }}
      >
        {isStarting ? <Spinner size="1" /> : <SparkleIcon size={14} />}
        Generate
      </Button>
    </Flex>
  );
}

// Shown while the generation task is running: a centered status with a spinner
// and a button to jump to the task that's doing the work.
function GeneratingState({
  channelId,
  taskId,
}: {
  channelId: string;
  taskId: string;
}) {
  return (
    <Flex
      direction="column"
      align="center"
      gap="4"
      className="mx-auto max-w-[440px] py-16 text-center"
    >
      <Box className="rounded-lg border border-gray-6 border-dashed p-3">
        <SpinnerGapIcon size={18} className="animate-spin text-accent-9" />
      </Box>
      <Flex direction="column" gap="1" align="center">
        <Text className="font-medium text-[14px] text-gray-12">Generating</Text>
        <Text className="text-[13px] text-gray-10">
          An agent is writing this CONTEXT.md.
        </Text>
      </Flex>
      <Button size="2" variant="soft" asChild>
        <Link
          to="/website/$channelId/tasks/$taskId"
          params={{ channelId, taskId }}
        >
          View task
        </Link>
      </Button>
    </Flex>
  );
}

// A compact, readable handle for a task uuid in inline text.
function shortTaskId(taskId: string): string {
  return taskId.slice(0, 8);
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
