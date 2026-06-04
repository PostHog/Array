import { useCanvasChatStore } from "@features/canvas/stores/canvasChatStore";
import type { Spec } from "@json-render/react";
import { trpcClient } from "@renderer/trpc/client";
import { logger } from "@utils/logger";

const log = logger.scope("canvas-subscriptions");

// Streams canvas generation events for a thread into the chat store. Scoped to
// the canvas surface: started/disposed by the WebsiteCanvas component.
export function registerCanvasSubscription(threadId: string): () => void {
  const subscription = trpcClient.canvasGen.onEvent.subscribe(
    { threadId },
    {
      onData: (event) => {
        const store = useCanvasChatStore.getState();
        switch (event.type) {
          case "prose":
            store.appendProse(event.text);
            break;
          case "spec":
            store.setSpec(event.spec as unknown as Spec);
            break;
          case "tool":
            store.noteTool(event.toolName, event.status);
            break;
          case "done":
            store.finish();
            break;
          case "error":
            store.fail(event.message);
            break;
          case "started":
            break;
        }
      },
      onError: (error) => {
        log.error("Canvas subscription error", { error });
        useCanvasChatStore.getState().fail(String(error));
      },
    },
  );
  return () => subscription.unsubscribe();
}
