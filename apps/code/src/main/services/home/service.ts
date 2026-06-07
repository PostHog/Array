import {
  EMPTY_HOME_SNAPSHOT,
  HomeEvent,
  type HomeEvents,
  type HomeSnapshot,
  homeSnapshot,
} from "@shared/types/home-snapshot";
import { inject, injectable, postConstruct } from "inversify";
import { MAIN_TOKENS } from "../../di/tokens";
import { logger } from "../../utils/logger";
import { TypedEventEmitter } from "../../utils/typed-event-emitter";
import type { AuthService } from "../auth/service";

const log = logger.scope("home");

const POLL_INTERVAL_MS = 120_000;

/**
 * Reads the per-user Home snapshot from PostHog. All grouping, PR polling, and
 * classification happen server-side in the `evaluate-code-workstreams` Temporal
 * worker; this service is a thin authenticated client + poll loop that emits
 * {@link HomeEvent.SnapshotUpdated} when the snapshot changes.
 */
@injectable()
export class HomeService extends TypedEventEmitter<HomeEvents> {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastSerialized: string | null = null;

  constructor(
    @inject(MAIN_TOKENS.AuthService)
    private readonly authService: AuthService,
  ) {
    super();
  }

  @postConstruct()
  init(): void {
    this.timer = setInterval(() => {
      void this.poll();
    }, POLL_INTERVAL_MS);
  }

  dispose(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async getSnapshot(): Promise<HomeSnapshot> {
    const snapshot = (await this.fetchSnapshot()) ?? EMPTY_HOME_SNAPSHOT;
    this.lastSerialized = JSON.stringify(snapshot);
    return snapshot;
  }

  async refresh(): Promise<HomeSnapshot> {
    await this.requestServerRefresh();
    return this.getSnapshot();
  }

  private async poll(): Promise<void> {
    const snapshot = await this.fetchSnapshot();
    if (!snapshot) return;
    const serialized = JSON.stringify(snapshot);
    if (serialized === this.lastSerialized) return;
    this.lastSerialized = serialized;
    this.emit(HomeEvent.SnapshotUpdated, snapshot);
  }

  private async fetchSnapshot(): Promise<HomeSnapshot | null> {
    if (this.authService.getState().currentProjectId == null) return null;
    try {
      const res = await this.authService.authenticatedProjectFetch(
        "code_home/",
        { method: "GET" },
      );
      if (!res.ok) {
        log.warn("Failed to fetch home snapshot", { status: res.status });
        return null;
      }
      const parsed = homeSnapshot.safeParse(await res.json());
      if (!parsed.success) {
        log.warn("Home snapshot failed schema validation", {
          error: parsed.error.message,
        });
        return null;
      }
      return parsed.data;
    } catch (err) {
      log.warn("Error fetching home snapshot", {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  private async requestServerRefresh(): Promise<void> {
    if (this.authService.getState().currentProjectId == null) return;
    try {
      await this.authService.authenticatedProjectFetch("code_home/refresh/", {
        method: "POST",
      });
    } catch (err) {
      log.warn("Error requesting home refresh", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
