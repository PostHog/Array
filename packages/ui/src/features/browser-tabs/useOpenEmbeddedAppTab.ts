import { useHostTRPCClient } from "@posthog/host-router/react";
import { openOrFocusTab, primaryWindow } from "@posthog/shared";
import { embeddedAppTabView } from "@posthog/ui/features/embedded-app/embeddedAppTab";
import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { applyLocalTransform, persistWrite, readMirror } from "./tabsSync";

/**
 * EXPERIMENT (embedded webapp): open (or focus) a browser tab hosting the
 * embedded PostHog webapp at `path`.
 *
 * A plain router navigation is in-tab by design (the strip's navigation
 * effect retargets the active tab), so opening a NEW tab mirrors the strip's
 * own flow: apply the openOrFocus transform to the mirror local-first,
 * persist in the background, then navigate with the history entry stamped
 * with the tab id so the effect activates that tab instead of retargeting.
 */
export function useOpenEmbeddedAppTab(): (path: string) => void {
  const hostClient = useHostTRPCClient();
  const navigate = useNavigate();

  return useCallback(
    (path: string) => {
      const appView = embeddedAppTabView(path);
      const windowId = primaryWindow(readMirror())?.id;
      let tabId: string | undefined;
      if (windowId) {
        const input = {
          windowId,
          dashboardId: null,
          taskId: null,
          channelId: null,
          channelSection: null,
          appView,
        };
        const mintedId = crypto.randomUUID();
        tabId = mintedId;
        applyLocalTransform((s) => {
          const result = openOrFocusTab(s, {
            ...input,
            makeId: () => mintedId,
            now: Date.now,
          });
          tabId = result.tabId;
          return result.snapshot;
        });
        void persistWrite(() =>
          hostClient.browserTabs.openOrFocus.mutate({
            ...input,
            tabId: mintedId,
          }),
        );
      }
      void navigate({
        to: "/embedded-app",
        search: { path },
        state: (prev) => ({ ...prev, tabId }),
      });
    },
    [hostClient, navigate],
  );
}
