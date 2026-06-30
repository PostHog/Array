import { browserTabsStore } from "@posthog/core/browser-tabs/browserTabsStore";
import { createSelectors } from "@posthog/ui/hooks/createSelectors";

const tabs = createSelectors(browserTabsStore);

/** Single store-selector: the live tab/window snapshot mirrored from main. */
export function useTabsSnapshot() {
  return tabs.use.snapshot();
}

/**
 * True when the primary window's active tab is a blank "+" tab (no canvas, task,
 * or channel). The blank tab parks at `/website`, whose index would otherwise
 * redirect to the first channel — callers use this to suppress that redirect so
 * a blank tab (and the in-flight navigation leaving it) isn't hijacked.
 */
export function useActiveTabIsBlank(): boolean {
  const snapshot = useTabsSnapshot();
  const w = snapshot.windows.find((x) => x.isPrimary) ?? snapshot.windows[0];
  if (!w?.activeTabId) return false;
  const t = snapshot.tabs.find((x) => x.id === w.activeTabId);
  return (
    !!t && t.dashboardId == null && t.taskId == null && t.channelId == null
  );
}
