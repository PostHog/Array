import { useFreeformChatStore } from "@posthog/ui/features/canvas/stores/freeformChatStore";
import { logger } from "@posthog/ui/shell/logger";
import { hostClient } from "../hostClient";

const log = logger.scope("freeform-subscriptions");

// Guards against duplicate subscriptions per thread (StrictMode double-mount).
const active = new Set<string>();

// Streams freeform generation events (prose + code snapshots) for a thread into
// the freeform chat store. Started/disposed by the FreeformCanvasView.
export function registerFreeformSubscription(threadId: string): () => void {
  if (active.has(threadId)) return () => {};
  active.add(threadId);

  const subscription = hostClient().freeformGen.onEvent.subscribe(
    { threadId },
    {
      onData: (event) => {
        const store = useFreeformChatStore.getState();
        switch (event.type) {
          case "prose":
            store.appendProse(threadId, event.text);
            break;
          case "code":
            store.setCode(threadId, event.code);
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
        log.error("Freeform subscription error", { error });
        useFreeformChatStore.getState().fail(threadId, String(error));
      },
    },
  );
  return () => {
    active.delete(threadId);
    subscription.unsubscribe();
  };
}
