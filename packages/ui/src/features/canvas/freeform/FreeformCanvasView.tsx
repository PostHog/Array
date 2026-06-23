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
import { useChannels } from "@posthog/ui/features/canvas/hooks/useChannels";
import {
  useFreeformChatStore,
  useFreeformThread,
} from "@posthog/ui/features/canvas/stores/freeformChatStore";
import { useSessionForTask } from "@posthog/ui/features/sessions/useSession";
import { taskDetailQuery } from "@posthog/ui/features/tasks/queries";
import { ErrorBoundary } from "@posthog/ui/shell/ErrorBoundary";
import {
  Box,
  Flex,
  Button as RadixButton,
  ScrollArea,
  Text,
} from "@radix-ui/themes";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import { FreeformCanvas } from "./FreeformCanvas";
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

  // Run status: cloud reports via cloudStatus / latest_run.status; local is tied
  // to the live ACP session. Assume running while the task record loads.
  const { data: genTask, isLoading: genTaskLoading } = useQuery({
    ...taskDetailQuery(genTaskId ?? ""),
    enabled: !!genTaskId,
    refetchInterval: genTaskId ? 5000 : false,
  });
  const genSession = useSessionForTask(genTaskId ?? undefined);
  const running = (() => {
    if (!genTaskId) return false;
    if (genTaskLoading) return true;
    if (genTask?.latest_run?.environment === "cloud") {
      const cloudStatus =
        genSession?.cloudStatus ?? genTask?.latest_run?.status ?? null;
      return !isTerminalStatus(cloudStatus);
    }
    return (
      genSession?.status === "connecting" || genSession?.status === "connected"
    );
  })();
  const isGenerating = !!genTaskId && running;

  // Poll the record while generating so a just-published canvas appears.
  useQuery(
    trpc.dashboards.get.queryOptions(
      { id: dashboardId },
      {
        enabled: !!dashboardId && isGenerating,
        refetchInterval: isGenerating ? 4000 : false,
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
          <ScrollArea className="h-full">
            {showCanvas ? (
              <ErrorBoundary name="freeform-canvas" resetKey={threadId}>
                <FreeformCanvas
                  code={code}
                  mode="edit"
                  onDataRequest={handleFreeformDataRequest}
                  onError={onError}
                  onRendered={onRendered}
                  onNavigate={onNavigate}
                  analytics={analytics}
                />
              </ErrorBoundary>
            ) : showGeneratingState ? (
              <GeneratingState channelId={channelId} taskId={genTaskId ?? ""} />
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
