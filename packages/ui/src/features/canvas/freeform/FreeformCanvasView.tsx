import {
  ArrowCounterClockwiseIcon,
  ArrowUUpLeftIcon,
  ArrowUUpRightIcon,
  ShapesIcon,
  SpinnerGapIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import type { CanvasAnalyticsConfig } from "@posthog/core/canvas/freeformSchemas";
import { useHostTRPC } from "@posthog/host-router/react";
import {
  Button,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@posthog/quill";
import { isTerminalStatus } from "@posthog/shared/domain-types";
import { isCanvasGenerationRunning } from "@posthog/ui/features/canvas/freeform/canvasGenerationStatus";
import { useChannels } from "@posthog/ui/features/canvas/hooks/useChannels";
import {
  useFreeformChatStore,
  useFreeformThread,
} from "@posthog/ui/features/canvas/stores/freeformChatStore";
import { useSessionForTask } from "@posthog/ui/features/sessions/useSession";
import { taskDetailQuery } from "@posthog/ui/features/tasks/queries";
import {
  Box,
  Flex,
  Button as RadixButton,
  ScrollArea,
  Text,
} from "@radix-ui/themes";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import { CanvasFramePlaceholder } from "./CanvasFramePlaceholder";
import { FreeformGenerateBar } from "./FreeformGenerateBar";
import { handleFreeformDataRequest } from "./freeformDataBridge";
import { useCanvasNavigation, useHomeCanvasReset } from "./useHomeCanvasView";

// The dashboardId a thread is keyed on ("dashboard:<id>" → "<id>").
function dashboardIdOf(threadId: string): string {
  return threadId.replace(/^dashboard:/, "");
}

// A freeform (React-in-iframe) canvas: the sandboxed app, with version controls
// and an edit composer (edit mode only). Generation runs as a dedicated task —
// when one is in flight the screen shows a "Generating… View task" state, like
// CONTEXT.md. The published result is adopted into the canvas record and synced
// into the working copy by WebsiteDashboard.
export function FreeformCanvasView({
  threadId,
  interactive,
}: {
  threadId: string;
  interactive: boolean;
}) {
  const dashboardId = dashboardIdOf(threadId);
  const { code, versions, currentVersionId, runtimeError } =
    useFreeformThread(threadId);
  const undo = useFreeformChatStore((s) => s.undo);
  const redo = useFreeformChatStore((s) => s.redo);
  const setRuntimeError = useFreeformChatStore((s) => s.setRuntimeError);

  const trpc = useHostTRPC();

  // The generation-task association lives in the canvas record's meta. Poll it
  // while a task is running so the published code + the cleared association show
  // up without a manual refresh (WebsiteDashboard re-syncs the working copy).
  const { data: dashboard } = useQuery(
    trpc.dashboards.get.queryOptions(
      { id: dashboardId },
      { enabled: !!dashboardId, staleTime: 4000 },
    ),
  );
  const genTaskId = dashboard?.generationTaskId ?? null;
  const channelId = dashboard?.channelId ?? "";

  const { channels } = useChannels();
  const channelName = useMemo(
    () => channels.find((c) => c.id === channelId)?.name ?? "",
    [channels, channelId],
  );

  // The "Reset to default" affordance, shown only on a channel's home canvas.
  const {
    isHomeCanvas,
    isResetting,
    reset: onResetToDefault,
  } = useHomeCanvasReset({ channelId, dashboardId, threadId });

  // Run status derivation (cloud vs local) lives in a pure, tested helper; a
  // terminal run record always ends "running" so a stale session can't strand
  // the canvas on "Generating".
  const { data: genTask, isLoading: genTaskLoading } = useQuery({
    ...taskDetailQuery(genTaskId ?? ""),
    enabled: !!genTaskId,
    refetchInterval: genTaskId ? 5000 : false,
  });
  const genSession = useSessionForTask(genTaskId ?? undefined);
  // Whether the run's session is still alive. Drives record polling so a freshly
  // published canvas gets picked up. A local ACP session stays "connected" after
  // its generation prompt finishes, so this keeps syncing until it disconnects.
  // Uses the shared, tested helper, which also stops once the run record is
  // terminal so a stale/stuck session can't keep us polling forever.
  const isSyncing = isCanvasGenerationRunning({
    genTaskId,
    genTaskLoading,
    latestRun: genTask?.latest_run,
    session: genSession,
  });
  // Whether the agent is actively producing the canvas right now. Drives the
  // "Generating…" UI (notice, composer, undo/redo). A local session stays
  // "connected" after its single generation prompt completes, so key off the
  // pending prompt, not the connection — otherwise the notice never clears. A
  // terminal run record always wins so a stuck session can't strand the notice.
  const isGenerating = (() => {
    if (!genTaskId) return false;
    if (genTaskLoading) return true;
    if (genTask?.latest_run?.environment === "cloud") {
      const cloudStatus =
        genSession?.cloudStatus ?? genTask?.latest_run?.status ?? null;
      return !isTerminalStatus(cloudStatus);
    }
    if (isTerminalStatus(genTask?.latest_run?.status)) return false;
    return (
      genSession?.status === "connecting" ||
      genSession?.isPromptPending === true
    );
  })();

  // Poll the record while the session is alive so a just-published canvas
  // appears (the publish lands while the prompt is still pending).
  useQuery(
    trpc.dashboards.get.queryOptions(
      { id: dashboardId },
      {
        enabled: !!dashboardId && isSyncing,
        refetchInterval: isSyncing ? 4000 : false,
      },
    ),
  );

  const trpcCapture = trpc.canvasData.captureConfig.queryOptions(undefined, {
    staleTime: 5 * 60_000,
  });
  const { data: captureConfig } = useQuery(trpcCapture);
  const analytics: CanvasAnalyticsConfig | undefined = useMemo(
    () =>
      captureConfig
        ? {
            apiHost: captureConfig.apiHost,
            publicKey: captureConfig.publicKey,
            distinctId: captureConfig.distinctId,
            persist: false,
          }
        : undefined,
    [captureConfig],
  );

  const idx = versions.findIndex((v) => v.id === currentVersionId);
  const canUndo = idx > 0;
  const canRedo = idx !== -1 && idx < versions.length - 1;

  // The data bridge is a pure function; the QueryClient (its read cache) is
  // injected here rather than resolved inside it.
  const queryClient = useQueryClient();
  const onDataRequest = useCallback(
    (method: string, payload: unknown) =>
      handleFreeformDataRequest(method, payload, queryClient),
    [queryClient],
  );

  const onError = useCallback(
    (message: string) => setRuntimeError(threadId, message),
    [threadId, setRuntimeError],
  );
  const onRendered = useCallback(
    () => setRuntimeError(threadId, null),
    [threadId, setRuntimeError],
  );

  // Routes the canvas's allowlisted nav intents within this channel.
  const onNavigate = useCanvasNavigation(channelId);

  // The edit composer's draft, lifted so self-repair can prefill it.
  const [draft, setDraft] = useState("");
  const askAgentToFix = () => {
    if (!runtimeError) return;
    setDraft(
      `The app threw a runtime error: "${runtimeError}". Fix it and rewrite the whole file.`,
    );
  };

  const showCanvas = !!code;
  const showGeneratingState = isGenerating && !code;
  const showComposer = interactive && !isGenerating;

  return (
    <Flex height="100%" overflow="hidden">
      <Flex direction="column" className="flex-1 bg-gray-1" overflow="hidden">
        {interactive && (
          <Flex
            align="center"
            justify="between"
            className="shrink-0 border-gray-6 border-b bg-gray-2 px-3 py-1.5"
          >
            <Flex align="center" gap="1">
              <Button
                size="icon"
                variant="default"
                aria-label="Undo"
                disabled={!canUndo || isGenerating}
                onClick={() => undo(threadId)}
              >
                <ArrowUUpLeftIcon size={16} />
              </Button>
              <Button
                size="icon"
                variant="default"
                aria-label="Redo"
                disabled={!canRedo || isGenerating}
                onClick={() => redo(threadId)}
              >
                <ArrowUUpRightIcon size={16} />
              </Button>
              {versions.length > 0 && (
                <Text size="1" className="ml-1 text-gray-9">
                  v{idx + 1}/{versions.length}
                </Text>
              )}
              {isHomeCanvas && (
                <Button
                  size="sm"
                  variant="default"
                  className="ml-1"
                  disabled={isGenerating || isResetting}
                  onClick={onResetToDefault}
                >
                  <ArrowCounterClockwiseIcon size={14} />
                  {isResetting ? "Resetting…" : "Reset to default"}
                </Button>
              )}
            </Flex>
            {isGenerating && genTaskId ? (
              <Flex align="center" gap="2">
                <SpinnerGapIcon
                  size={14}
                  className="animate-spin text-accent-9"
                />
                <Text size="1" className="text-gray-10">
                  Generating
                </Text>
                <RadixButton size="1" variant="soft" asChild>
                  <Link
                    to="/website/$channelId/tasks/$taskId"
                    params={{ channelId, taskId: genTaskId }}
                  >
                    View task
                  </Link>
                </RadixButton>
              </Flex>
            ) : (
              runtimeError && (
                <Flex align="center" gap="2">
                  <Flex align="center" gap="1" className="text-red-11">
                    <WarningIcon size={14} />
                    <Text size="1">Runtime error</Text>
                  </Flex>
                  <Button size="sm" variant="outline" onClick={askAgentToFix}>
                    Ask agent to fix
                  </Button>
                </Flex>
              )
            )}
          </Flex>
        )}

        <Box position="relative" className="min-h-0 flex-1">
          {/* Swooping accent bar across the top while a generation task runs. */}
          <div
            aria-hidden
            className={
              isGenerating
                ? "quill-section-loading quill-section-loading--active"
                : "quill-section-loading"
            }
          />
          {showCanvas ? (
            // The iframe lives in the persistent warm-frame pool (CanvasFrameHost);
            // this placeholder just reserves the viewport box and owns scroll via
            // the host's overlay, so the canvas survives navigation without a reload.
            <Box className="h-full w-full">
              <CanvasFramePlaceholder
                dashboardId={dashboardId}
                code={code}
                analytics={analytics}
                onDataRequest={onDataRequest}
                onError={onError}
                onRendered={onRendered}
                onNavigate={onNavigate}
              />
            </Box>
          ) : (
            <ScrollArea className="h-full">
              {showGeneratingState ? (
                <GeneratingState
                  channelId={channelId}
                  taskId={genTaskId ?? ""}
                />
              ) : (
                <Empty className="h-full">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <ShapesIcon size={24} />
                    </EmptyMedia>
                    <EmptyTitle>Freeform canvas</EmptyTitle>
                    <EmptyDescription>
                      {interactive
                        ? "Describe the canvas below to build it with an agent."
                        : "This canvas is empty. Hit Edit to build it with an agent."}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
            </ScrollArea>
          )}
        </Box>

        {showComposer && (
          <Box className="shrink-0 border-gray-6 border-t bg-gray-2 p-3">
            <FreeformGenerateBar
              dashboardId={dashboardId}
              channelId={channelId}
              channelName={channelName}
              name={dashboard?.name ?? "Canvas"}
              templateId={dashboard?.templateId}
              currentCode={code || undefined}
              value={draft}
              onValueChange={setDraft}
            />
          </Box>
        )}
      </Flex>
    </Flex>
  );
}

// Centered status shown while a generation task runs on an empty canvas, with a
// button to jump to the task doing the work.
function GeneratingState({
  channelId,
  taskId,
}: {
  channelId: string;
  taskId: string;
}) {
  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SpinnerGapIcon size={18} className="animate-spin text-accent-9" />
        </EmptyMedia>
        <EmptyTitle>Generating</EmptyTitle>
        <EmptyDescription>An agent is building this canvas.</EmptyDescription>
      </EmptyHeader>
      {taskId && (
        <EmptyContent>
          <Button
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
          </Button>
        </EmptyContent>
      )}
    </Empty>
  );
}
