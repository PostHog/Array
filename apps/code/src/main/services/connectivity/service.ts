import { getBackoffDelay } from "@shared/utils/backoff";
import { injectable, postConstruct, preDestroy } from "inversify";
import { logger } from "../../utils/logger";
import { TypedEventEmitter } from "../../utils/typed-event-emitter";
import {
  ConnectivityEvent,
  type ConnectivityEvents,
  type ConnectivityStatusOutput,
} from "./schemas";

const log = logger.scope("connectivity");

const CHECK_URLS = [
  "https://www.google.com/generate_204",
  "https://www.cloudflare.com/cdn-cgi/trace",
];
const CHECK_TIMEOUT_MS = 5_000;
const OFFLINE_CONFIRM_THRESHOLD = 2;
const MIN_POLL_INTERVAL_MS = 3_000;
const MAX_POLL_INTERVAL_MS = 10_000;
const ONLINE_POLL_INTERVAL_MS = 3_000;

@injectable()
export class ConnectivityService extends TypedEventEmitter<ConnectivityEvents> {
  private isOnline = false;
  private pollTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private offlinePollAttempt = 0;
  private consecutiveFailures = 0;

  @postConstruct()
  init(): void {
    // Assume online until the first check says otherwise, so dependent services
    // don't needlessly queue offline-recovery work on boot.
    this.isOnline = true;
    log.info("Connectivity service starting (assumed online)");

    void this.checkConnectivity();
    this.startPolling();
  }

  getStatus(): ConnectivityStatusOutput {
    return { isOnline: this.isOnline };
  }

  async checkNow(): Promise<ConnectivityStatusOutput> {
    await this.checkConnectivity();
    return { isOnline: this.isOnline };
  }

  private setOnline(online: boolean): void {
    if (this.isOnline === online) return;

    this.isOnline = online;
    log.info("Connectivity status changed", { isOnline: online });
    this.emit(ConnectivityEvent.StatusChange, { isOnline: online });

    this.offlinePollAttempt = 0;
  }

  private async checkConnectivity(): Promise<void> {
    const verified = await this.verifyWithHttp();

    if (verified) {
      this.consecutiveFailures = 0;
      this.setOnline(true);
      return;
    }

    this.consecutiveFailures++;
    if (this.consecutiveFailures >= OFFLINE_CONFIRM_THRESHOLD) {
      this.setOnline(false);
    }
  }

  private async verifyWithHttp(): Promise<boolean> {
    try {
      // Resolves as soon as the first host responds reachably; rejects only
      // when every host fails.
      await Promise.any(CHECK_URLS.map((url) => this.probe(url)));
      return true;
    } catch (error) {
      log.debug("HTTP connectivity check failed", { error });
      return false;
    }
  }

  private async probe(url: string): Promise<void> {
    const response = await fetch(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    if (!(response.ok || response.status === 204)) {
      throw new Error(`Unexpected status ${response.status} from ${url}`);
    }
  }

  private startPolling(): void {
    if (this.pollTimeoutId) return;

    this.offlinePollAttempt = 0;
    this.schedulePoll();
  }

  private schedulePoll(): void {
    // when online: just poll periodically
    // when offline: poll more frequently with backoff to detect recovery
    const interval = this.isOnline
      ? ONLINE_POLL_INTERVAL_MS
      : getBackoffDelay(this.offlinePollAttempt, {
          initialDelayMs: MIN_POLL_INTERVAL_MS,
          maxDelayMs: MAX_POLL_INTERVAL_MS,
          multiplier: 1.5,
        });

    this.pollTimeoutId = setTimeout(async () => {
      this.pollTimeoutId = null;

      const wasOffline = !this.isOnline;
      await this.checkConnectivity();

      if (!this.isOnline && wasOffline) {
        this.offlinePollAttempt++;
      }

      this.schedulePoll();
    }, interval);
  }

  @preDestroy()
  stopPolling(): void {
    if (this.pollTimeoutId) {
      clearTimeout(this.pollTimeoutId);
      this.pollTimeoutId = null;
    }
  }
}
