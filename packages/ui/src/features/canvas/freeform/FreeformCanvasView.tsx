import {
  ArrowUUpLeftIcon,
  ArrowUUpRightIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import type { CanvasAnalyticsConfig } from "@posthog/core/canvas/freeformSchemas";
import { useHostTRPC } from "@posthog/host-router/react";
import { Button } from "@posthog/quill";
import {
  useFreeformChatStore,
  useFreeformThread,
} from "@posthog/ui/features/canvas/stores/freeformChatStore";
import { ErrorBoundary } from "@posthog/ui/shell/ErrorBoundary";
import { Flex, ScrollArea, Text } from "@radix-ui/themes";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo } from "react";
import { FreeformCanvas } from "./FreeformCanvas";
import { FreeformChat } from "./FreeformChat";
import { handleFreeformDataRequest } from "./freeformDataBridge";
import { registerFreeformSubscription } from "./freeformSubscription";

// A freeform (React-in-iframe) canvas: the sandboxed app on the left, a chat
// panel on the right (edit mode only). Streams code from the agent and renders
// it live; tracks version history for undo/redo.
export function FreeformCanvasView({
  threadId,
  interactive,
}: {
  threadId: string;
  interactive: boolean;
}) {
  const { code, versions, currentVersionId, runtimeError, isStreaming } =
    useFreeformThread(threadId);
  const undo = useFreeformChatStore((s) => s.undo);
  const redo = useFreeformChatStore((s) => s.redo);
  const send = useFreeformChatStore((s) => s.send);
  const setRuntimeError = useFreeformChatStore((s) => s.setRuntimeError);

  useEffect(() => registerFreeformSubscription(threadId), [threadId]);

  // Public capture key + the signed-in user's distinct_id, so posthog-js can run
  // inside the iframe (analytics + session replay). Edit mode runs on a
  // null-origin sandbox (no storage) → memory session (persist:false).
  const trpc = useHostTRPC();
  const { data: captureConfig } = useQuery(
    trpc.canvasData.captureConfig.queryOptions(undefined, {
      staleTime: 5 * 60_000,
    }),
  );
  // Memoised on the (stable) query result so its identity doesn't change every
  // render — otherwise FreeformCanvas's init effect re-fires and re-posts the
  // whole file to the iframe on every render during streaming.
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

  // Q7 self-repair: hand the runtime error back to the agent to fix.
  const askAgentToFix = () => {
    if (!runtimeError) return;
    void send(
      threadId,
      `The app threw a runtime error: "${runtimeError}". Fix it and rewrite the whole file.`,
    );
  };

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
                disabled={!canUndo || isStreaming}
                onClick={() => undo(threadId)}
              >
                <ArrowUUpLeftIcon size={16} />
              </Button>
              <Button
                size="icon"
                variant="default"
                aria-label="Redo"
                disabled={!canRedo || isStreaming}
                onClick={() => redo(threadId)}
              >
                <ArrowUUpRightIcon size={16} />
              </Button>
              {versions.length > 0 && (
                <Text size="1" className="ml-1 text-gray-9">
                  v{idx + 1}/{versions.length}
                </Text>
              )}
            </Flex>
            {runtimeError && (
              <Flex align="center" gap="2">
                <Flex align="center" gap="1" className="text-red-11">
                  <WarningIcon size={14} />
                  <Text size="1">Runtime error</Text>
                </Flex>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isStreaming}
                  onClick={askAgentToFix}
                >
                  Ask agent to fix
                </Button>
              </Flex>
            )}
          </Flex>
        )}

        <ScrollArea className="flex-1">
          {code ? (
            <ErrorBoundary name="freeform-canvas" resetKey={threadId}>
              <FreeformCanvas
                code={code}
                mode="edit"
                onDataRequest={handleFreeformDataRequest}
                onError={onError}
                onRendered={onRendered}
                analytics={analytics}
              />
            </ErrorBoundary>
          ) : (
            <Flex
              direction="column"
              align="center"
              justify="center"
              height="100%"
              gap="1"
              className="px-6 text-center"
            >
              <Text size="3" weight="bold" className="text-gray-12">
                Freeform canvas
              </Text>
              <Text size="2" className="text-gray-10">
                {interactive
                  ? "Ask the agent on the right to build a React app from your PostHog data."
                  : "This canvas is empty. Hit Edit to build it with the agent."}
              </Text>
            </Flex>
          )}
        </ScrollArea>
      </Flex>

      {interactive && <FreeformChat threadId={threadId} />}
    </Flex>
  );
}
