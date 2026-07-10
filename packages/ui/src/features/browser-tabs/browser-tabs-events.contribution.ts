import type { Contribution } from "@posthog/di/contribution";
import { ROOT_LOGGER, type RootLogger } from "@posthog/di/logger";
import { inject, injectable } from "inversify";
import {
  BROWSER_TABS_CLIENT,
  type BrowserTabsClient,
} from "./browserTabsClient";
import { applyRemoteSnapshot, registerSnapshotFetcher } from "./tabsSync";

const SEED_ATTEMPTS = 3;
const SEED_RETRY_BASE_MS = 1_000;

/**
 * Seeds the renderer tab snapshot at startup and keeps it live via the
 * snapshot-change subscription, so a mutation in any window is reflected here.
 * Applied through the tabsSync gate: pushes are dropped while this window has
 * writes in flight, so an echo of our own mutation can't rewind newer local
 * state (see tabsSync.ts).
 */
@injectable()
export class BrowserTabsEventsContribution implements Contribution {
  private subscription: { unsubscribe: () => void } | null = null;
  private readonly logger;

  constructor(
    @inject(BROWSER_TABS_CLIENT)
    private readonly client: BrowserTabsClient,
    @inject(ROOT_LOGGER)
    logger: RootLogger,
  ) {
    this.logger = logger.scope("browser-tabs-events");
  }

  start(): void {
    // Lets tabsSync re-pull the authoritative snapshot after a FAILED write
    // (a failed mutation emits no snapshotChange, so nothing else reconciles).
    registerSnapshotFetcher(() => this.client.getSnapshot());

    void this.seedWithRetry();

    // Replace any prior handle so a repeated start() can't leak a subscription.
    this.subscription?.unsubscribe();
    this.subscription = this.client.onSnapshotChange({
      onData: (snapshot) => applyRemoteSnapshot(snapshot),
    });
  }

  // A failed seed used to be swallowed, leaving the mirror windowless forever —
  // the strip renders only a dead "+" in that state. Retry with backoff, and
  // make the terminal failure loud so a broken service can't fail silently.
  private async seedWithRetry(): Promise<void> {
    for (let attempt = 1; attempt <= SEED_ATTEMPTS; attempt++) {
      try {
        applyRemoteSnapshot(await this.client.getSnapshot());
        return;
      } catch (error) {
        if (attempt === SEED_ATTEMPTS) {
          this.logger.error("browser-tabs snapshot seed failed", { error });
          return;
        }
        await new Promise((resolve) =>
          setTimeout(resolve, SEED_RETRY_BASE_MS * 2 ** (attempt - 1)),
        );
      }
    }
  }

  stop(): void {
    registerSnapshotFetcher(null);
    this.subscription?.unsubscribe();
    this.subscription = null;
  }
}
