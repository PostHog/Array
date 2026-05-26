import Store from "electron-store";
import { getUserDataDir } from "../../utils/env";

interface UsageMonitorSchema {
  // Map of dedupe-keys ⇒ ISO timestamp anchor at which the threshold was
  // first fired. Stored so we don't re-toast after relaunch within the same
  // billing window. Anchored entries with a past anchor are pruned on boot.
  thresholdsSeen: Record<string, string>;
}

export const usageMonitorStore = new Store<UsageMonitorSchema>({
  name: "usage-monitor",
  cwd: getUserDataDir(),
  defaults: {
    thresholdsSeen: {},
  },
});
