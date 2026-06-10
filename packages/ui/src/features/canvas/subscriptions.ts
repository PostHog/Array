import type { Spec } from "@json-render/react";
import { useCanvasChatStore } from "@posthog/ui/features/canvas/stores/canvasChatStore";
import { logger } from "@posthog/ui/shell/logger";
import { hostClient } from "./hostClient";

const log = logger.scope("canvas-subscriptions");

// Guards against duplicate subscriptions per thread (e.g. React StrictMode
// double-mounts in dev), which would otherwise stack IPC listeners.
const active = new Set<string>();

// Streams canvas generation events for a thread into the chat store. Scoped to
// the canvas surface: started/disposed by the WebsiteCanvas component.
export function registerCanvasSubscription(threadId: string): () => void {
  if (active.has(threadId)) return () => {};
  active.add(threadId);

  const subscription = hostClient().canvasGen.onEvent.subscribe(
    { threadId },
    {
      onData: (event) => {
        const store = useCanvasChatStore.getState();
        switch (event.type) {
          case "prose":
            store.appendProse(threadId, event.text);
            break;
          case "spec":
            store.setSpec(threadId, event.spec as unknown as Spec);
            break;
          case "tool":
            store.noteTool(threadId, event.toolName, event.status);
            break;
          case "done":
            store.finish(threadId);
            break;
          case "error":
            store.fail(threadId, event.message);
            break;
          case "started":
            break;
        }
      },
      onError: (error) => {
        log.error("Canvas subscription error", { error });
        useCanvasChatStore.getState().fail(threadId, String(error));
      },
    },
  );
  return () => {
    active.delete(threadId);
    subscription.unsubscribe();
  };
}
