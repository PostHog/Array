import { browserTabsStore } from "@posthog/core/browser-tabs/browserTabsStore";
import type { Contribution } from "@posthog/di/contribution";
import { inject, injectable } from "inversify";
import {
  BROWSER_TABS_CLIENT,
  type BrowserTabsClient,
} from "./browserTabsClient";

/**
 * Seeds the renderer tab snapshot at startup and keeps it live via the
 * snapshot-change subscription, so a mutation in any window is reflected here.
 */
@injectable()
export class BrowserTabsEventsContribution implements Contribution {
  private subscription: { unsubscribe: () => void } | null = null;

  constructor(
    @inject(BROWSER_TABS_CLIENT)
    private readonly client: BrowserTabsClient,
  ) {}

  start(): void {
    const { setSnapshot } = browserTabsStore.getState();

    void this.client
      .getSnapshot()
      .then((snapshot) => setSnapshot(snapshot))
      .catch(() => undefined);

    // Replace any prior handle so a repeated start() can't leak a subscription.
    this.subscription?.unsubscribe();
    this.subscription = this.client.onSnapshotChange({
      onData: (snapshot) => setSnapshot(snapshot),
    });
  }

  stop(): void {
    this.subscription?.unsubscribe();
    this.subscription = null;
  }
}
