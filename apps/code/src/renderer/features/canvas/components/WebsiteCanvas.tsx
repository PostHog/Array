import { CanvasChat } from "@features/canvas/components/CanvasChat";
import { CanvasRenderer } from "@features/canvas/genui/registry";
import {
  CANVAS_WEBSITE_THREAD,
  useCanvasChatStore,
} from "@features/canvas/stores/canvasChatStore";
import { registerCanvasSubscription } from "@features/canvas/subscriptions";
import { Flex, ScrollArea, Text } from "@radix-ui/themes";
import { useEffect } from "react";

// The /website canvas: an agent-built data UI on the left, a chat panel on the
// right. The canvas spec is streamed from the agent via the chat store.
export function WebsiteCanvas() {
  const spec = useCanvasChatStore((s) => s.spec);
  const isStreaming = useCanvasChatStore((s) => s.isStreaming);

  useEffect(() => registerCanvasSubscription(CANVAS_WEBSITE_THREAD), []);

  return (
    <Flex height="100%" overflow="hidden">
      <ScrollArea className="flex-1 bg-gray-1">
        {spec ? (
          <CanvasRenderer spec={spec} loading={isStreaming} />
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
      <CanvasChat />
    </Flex>
  );
}
