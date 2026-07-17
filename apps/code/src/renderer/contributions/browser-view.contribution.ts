import type { Contribution } from "@posthog/di/contribution";
import { BROWSER_TAB_FLAG } from "@posthog/shared/constants";
import type { FeatureFlags } from "@posthog/ui/features/feature-flags/identifiers";
import { trpcClient } from "@renderer/trpc/client";

export class BrowserViewContribution implements Contribution {
  constructor(private readonly featureFlags: FeatureFlags) {}

  start(): void {
    const sync = (): void => {
      const enabled =
        import.meta.env.DEV || this.featureFlags.isEnabled(BROWSER_TAB_FLAG);
      void trpcClient.browserView.setEnabled.mutate({ enabled });
    };

    sync();
    this.featureFlags.onFlagsLoaded(sync);
  }
}
