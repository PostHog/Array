import { useContextGenStore } from "@posthog/ui/features/canvas/stores/contextGenStore";
import { logger } from "@posthog/ui/shell/logger";
import { hostClient } from "./hostClient";

const log = logger.scope("context-subscriptions");

// Guards against duplicate subscriptions per channel (e.g. React StrictMode
// double-mounts in dev), which would otherwise stack IPC listeners.
const active = new Set<string>();

// Streams CONTEXT.md generation events for a channel into the context-gen
// store. Scoped to the CONTEXT.md surface: started/disposed by WebsiteContext.
export function registerContextSubscription(channelId: string): () => void {
  if (active.has(channelId)) return () => {};
  active.add(channelId);

  const subscription = hostClient().contextGen.onEvent.subscribe(
    { channelId },
    {
      onData: (event) => {
        const store = useContextGenStore.getState();
        switch (event.type) {
          case "prose":
            store.appendProse(channelId, event.text);
            break;
          case "tool":
            store.noteTool(channelId, event.toolName, event.status);
            break;
          case "done":
            store.finish(channelId);
            break;
          case "error":
            store.fail(channelId, event.message);
            break;
          case "started":
            break;
        }
      },
      onError: (error) => {
        log.error("Context subscription error", { error });
        useContextGenStore.getState().fail(channelId, String(error));
      },
    },
  );
  return () => {
    active.delete(channelId);
    subscription.unsubscribe();
  };
}
