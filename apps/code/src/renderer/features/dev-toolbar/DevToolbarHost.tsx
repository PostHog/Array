import { toast } from "@posthog/ui/primitives/toast";
import { useTRPC } from "@renderer/trpc/client";
import { useSubscription } from "@trpc/tanstack-react-query";
import { useEffect } from "react";
import { DevToolbar } from "./components/DevToolbar";
import { installMainThreadHealth } from "./mainThreadHealth";

export function DevToolbarHost() {
  const trpcReact = useTRPC();

  // Install main-thread health observers (longtasks + FPS) for the dev toolbar.
  useEffect(() => installMainThreadHealth(), []);

  // Surface dev-toolbar triggered toasts (e.g. quick actions test toasts).
  useSubscription(
    trpcReact.dev.onDevToast.subscriptionOptions(undefined, {
      onData: (data) => {
        if (data.variant === "error") {
          toast.error(data.message);
        } else {
          toast.info(data.message);
        }
      },
    }),
  );

  return <DevToolbar />;
}
