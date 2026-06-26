import {
  FileTextIcon,
  SparkleIcon,
  SpinnerGapIcon,
} from "@phosphor-icons/react";
import { FolderInstructionsConflictError } from "@posthog/api-client/posthog-client";
import { buildContextSaveProps } from "@posthog/core/canvas/canvasAnalytics";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Button as QuillButton,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@posthog/quill";
import { ANALYTICS_EVENTS } from "@posthog/shared/analytics-events";
import { isTerminalStatus } from "@posthog/shared/domain-types";
import { ChannelBreadcrumb } from "@posthog/ui/features/canvas/components/ChannelBreadcrumb";
import { useChannels } from "@posthog/ui/features/canvas/hooks/useChannels";
import {
  useFolderGenerationTask,
  useFolderGenerationTaskMutation,
} from "@posthog/ui/features/canvas/hooks/useFolderGenerationTask";
import {
  useFolderInstructions,
  useFolderInstructionsMutations,
  useFolderInstructionsVersions,
} from "@posthog/ui/features/canvas/hooks/useFolderInstructions";
import { useGenerateContext } from "@posthog/ui/features/canvas/hooks/useGenerateContext";
import { MarkdownRenderer } from "@posthog/ui/features/editor/components/MarkdownRenderer";
import { useSessionForTask } from "@posthog/ui/features/sessions/useSession";
import {
  type WorkspaceMode,
  WorkspaceModeSelect,
} from "@posthog/ui/features/task-detail/components/WorkspaceModeSelect";
import { taskDetailQuery } from "@posthog/ui/features/tasks/queries";
import { useSetHeaderContent } from "@posthog/ui/hooks/useSetHeaderContent";
import { track } from "@posthog/ui/shell/analytics";
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

  // CONTEXT.md generation runs as a normal task (local or cloud) in the
  // channel's repo. The "which task" association is stored server-side (shared
  // across the project) so any user sees an in-progress generation. We poll it
  // and the file while there's no published content yet.
  const pollGen = !hasInstructions;
  const { data: genTaskId } = useFolderGenerationTask(channelId, {
    refetchInterval: pollGen ? 5000 : false,
  });
  const { set: setGenerationTask } = useFolderGenerationTaskMutation(channelId);

  const genTaskQuery = useQuery({
    ...taskDetailQuery(genTaskId ?? ""),
    enabled: !!genTaskId && pollGen,
    refetchInterval: genTaskId && pollGen ? 5000 : false,
  });
  const genTask = genTaskQuery.data;
  const genSession = useSessionForTask(genTaskId ?? undefined);

  // Running is environment-aware: cloud runs report status via cloudStatus /
  // latest_run.status (a cloud session stays "connected" while polling), while
  // local runs are tied to the live ACP session. While the task record is still
  // loading we assume running to avoid a flash of "stopped".
  const running = (() => {
    if (!genTaskId) return false;
    if (genTaskQuery.isLoading) return true;
    if (genTask?.latest_run?.environment === "cloud") {
      const cloudStatus =
        genSession?.cloudStatus ?? genTask?.latest_run?.status ?? null;
      return !isTerminalStatus(cloudStatus);
    }
    return (
      genSession?.status === "connecting" || genSession?.status === "connected"
    );
  })();
  const isGenerating = !!genTaskId && pollGen && running;
  const isStopped = !!genTaskId && pollGen && !running;

  // While the agent runs, poll the published file so it shows up without a
  // manual refresh once the agent publishes via the MCP.
  useEffect(() => {
    if (!isGenerating) return;
    const id = setInterval(() => void refetchLatest(), 5000);
    return () => clearInterval(id);
  }, [isGenerating, refetchLatest]);

  // The agent publishes mid-run, just before its run ends — so when the run
  // stops, refetch once to catch a just-published file before concluding it
  // stopped without producing one.
  useEffect(() => {
    if (isStopped) void refetchLatest();
  }, [isStopped, refetchLatest]);

  // Once the file exists, the generation task has served its purpose — clear the
  // server association so everyone stops tracking it. (The backend should also
  // auto-clear on publish; this covers clients that observe content first.)
  useEffect(() => {
    if (genTaskId && hasInstructions)
      void setGenerationTask(null).catch(() => {});
  }, [genTaskId, hasInstructions, setGenerationTask]);

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
      <ChannelBreadcrumb
        channelName={channelName}
        leafIcon={<FileTextIcon size={12} />}
        leafLabel="CONTEXT.md"
      />
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
      track(
        ANALYTICS_EVENTS.CONTEXT_ACTION,
        buildContextSaveProps({ channelId, hasInstructions, success: true }),
      );
      setHasDraft(false);
      setMode("rendered");
    } catch {
      track(
        ANALYTICS_EVENTS.CONTEXT_ACTION,
        buildContextSaveProps({ channelId, hasInstructions, success: false }),
      );
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
                stoppedTaskId={isStopped ? (genTaskId ?? null) : null}
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
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FileTextIcon size={28} />
        </EmptyMedia>
        <EmptyTitle>No CONTEXT.md yet</EmptyTitle>
        <EmptyDescription>
          CONTEXT.md tells agents the specific details they need to know when
          working in <strong>{channelName}</strong> — conventions, gotchas, key
          files, and anything else that isn't obvious from the code.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
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
          <QuillButton variant="primary" size="default" onClick={onCreate}>
            Create
          </QuillButton>
          <GenerateWithAgent
            channelId={channelId}
            channelName={channelName}
            regenerate={!!stoppedTaskId}
          />
        </Flex>
      </EmptyContent>
    </Empty>
  );
}

// Kicks off a repo-less task that explores PostHog data (and a repo, if the
// agent decides it needs one) and publishes CONTEXT.md via the MCP. The user no
// longer picks a folder/repo up front — the agent attaches one lazily and asks
// to clarify if it can't find the right one.
function GenerateWithAgent({
  channelId,
  channelName,
  regenerate,
}: {
  channelId: string;
  channelName: string;
  regenerate: boolean;
}) {
  const { generate, isStarting } = useGenerateContext(channelId, channelName);

  // Generation always runs in the cloud, except the dev-only picker below lets a
  // local build of these features be tested before it's merged to the cloud env.
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("cloud");

  const onGenerate = () => {
    track(ANALYTICS_EVENTS.CONTEXT_ACTION, {
      action_type: "generate_started",
      channel_id: channelId,
    });
    void generate(workspaceMode);
  };

  return (
    <Flex align="center" gap="2">
      <QuillButton
        variant="outline"
        size="default"
        disabled={isStarting}
        onClick={onGenerate}
      >
        {isStarting ? <Spinner size="1" /> : <SparkleIcon size={14} />}
        {regenerate ? "Generate again" : "Generate with agent"}
      </QuillButton>
      {/* Dev-only: pick local vs cloud so a local build can be tested pre-merge. */}
      {import.meta.env.DEV && (
        <Tooltip>
          <TooltipTrigger render={<div />}>
            <WorkspaceModeSelect
              value={workspaceMode}
              onChange={setWorkspaceMode}
              overrideModes={["local", "cloud"]}
              disabled={isStarting}
              size="1"
            />
          </TooltipTrigger>
          <TooltipContent>
            Dev mode only — generation always runs in the cloud in production.
          </TooltipContent>
        </Tooltip>
      )}
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
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SpinnerGapIcon size={18} className="animate-spin text-accent-9" />
        </EmptyMedia>
        <EmptyTitle>Generating</EmptyTitle>
        <EmptyDescription>
          An agent is writing this CONTEXT.md.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <QuillButton
          variant="primary"
          size="default"
          render={
            <Link
              to="/website/$channelId/tasks/$taskId"
              params={{ channelId, taskId }}
            />
          }
        >
          View task
        </QuillButton>
      </EmptyContent>
    </Empty>
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
