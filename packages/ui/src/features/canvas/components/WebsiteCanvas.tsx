import { isNonEmptySpec } from "@json-render/core";
import { CanvasChat } from "@posthog/ui/features/canvas/components/CanvasChat";
import { EditRenderer } from "@posthog/ui/features/canvas/genui/EditRenderer";
import { useCanvasThread } from "@posthog/ui/features/canvas/stores/canvasChatStore";
import { registerCanvasSubscription } from "@posthog/ui/features/canvas/subscriptions";
import { ErrorBoundary } from "@posthog/ui/shell/ErrorBoundary";
import { Flex, ScrollArea, Text } from "@radix-ui/themes";
import { useEffect } from "react";

// Gen-UI canvas: an agent-built data UI on the left, a chat panel on the right.
// The canvas spec is streamed from the agent via the chat store, keyed by
// threadId so each surface (e.g. each dashboard) keeps its own session.
export function WebsiteCanvas({ threadId }: { threadId: string }) {
  const { spec, isStreaming } = useCanvasThread(threadId);

  useEffect(() => registerCanvasSubscription(threadId), [threadId]);

  return (
    <Flex height="100%" overflow="hidden">
      <ScrollArea className="flex-1 bg-gray-1">
        {isNonEmptySpec(spec) ? (
          // Key the boundary on the spec: a malformed mid-stream frame is caught
          // and rendering recovers when the next valid frame arrives.
          <ErrorBoundary
            name="canvas-renderer"
            resetKey={spec}
            fallback={
              <Flex align="center" justify="center" height="100%" p="6">
                <Text size="2" className="text-gray-10">
                  Rendering…
                </Text>
              </Flex>
            }
          >
            {/* Direct manipulation (drag/inline-edit) is live only when the
                agent isn't streaming, so user edits can't race snapshots. */}
            <EditRenderer
              spec={spec}
              threadId={threadId}
              interactive={!isStreaming}
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
              Blank canvas
            </Text>
            <Text size="2" className="text-gray-10">
              Ask the agent on the right to build a data-driven view from your
              PostHog project.
            </Text>
          </Flex>
        )}
      </ScrollArea>
      <CanvasChat threadId={threadId} />
    </Flex>
  );
}
