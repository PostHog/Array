import { inject, injectable, postConstruct, preDestroy } from "inversify";
import { MAIN_TOKENS } from "../../di/tokens";
import { logger } from "../../utils/logger";
import { TypedEventEmitter } from "../../utils/typed-event-emitter";
import { AgentServiceEvent } from "../agent/schemas";
import type { AgentService } from "../agent/service";
import type { UsageBucket, UsageOutput } from "../llm-gateway/schemas";
import type { LlmGatewayService } from "../llm-gateway/service";
import {
  USAGE_THRESHOLDS,
  UsageMonitorEvent,
  type UsageMonitorEvents,
  type UsageThreshold,
} from "./schemas";
import { usageMonitorStore } from "./store";

const log = logger.scope("usage-monitor");

// Coalesce bursts (e.g. 4 parallel agents finishing turns) into one trailing
// fetch per window.
const COALESCE_INTERVAL_MS = 5_000;

// Safety net for billing-period rollovers while the app sits idle and no
// LlmActivity events fire.
const BACKSTOP_INTERVAL_MS = 30 * 60_000;

type BucketName = "burst" | "sustained";

@injectable()
export class UsageMonitorService extends TypedEventEmitter<UsageMonitorEvents> {
  private backstopTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private coalesceTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private lastFetchStartedAt = 0;
  private isFetching = false;
  // Snapshot of the most recent thresholdsSeen map so we hit electron-store
  // only when we actually persist a new threshold.
  private thresholdsSeen: Record<string, string>;
  private latestUsage: UsageOutput | null = null;

  private readonly onLlmActivity = (): void => this.requestRefresh();

  constructor(
    @inject(MAIN_TOKENS.LlmGatewayService)
    private readonly llmGateway: LlmGatewayService,
    @inject(MAIN_TOKENS.AgentService)
    private readonly agentService: AgentService,
  ) {
    super();
    this.thresholdsSeen = { ...usageMonitorStore.get("thresholdsSeen", {}) };
  }

  /** Last successful usage snapshot; null until the first fetch succeeds. */
  getLatest(): UsageOutput | null {
    return this.latestUsage;
  }

  /** Trigger an immediate refresh, returning the resulting snapshot. */
  async refreshNow(): Promise<UsageOutput | null> {
    return this.fetchOnce();
  }

  /**
   * Request a refresh in response to agent activity (turn-complete events).
   * Coalesces bursts so N parallel agents finishing in quick succession
   * produce at most two fetches (leading + trailing) per `COALESCE_INTERVAL_MS`
   * window. Safe to call from many call sites with no rate-limit awareness.
   */
  requestRefresh(): void {
    if (this.coalesceTimeoutId) return;
    const now = Date.now();
    const delay = Math.max(
      0,
      this.lastFetchStartedAt + COALESCE_INTERVAL_MS - now,
    );
    this.coalesceTimeoutId = setTimeout(() => {
      this.coalesceTimeoutId = null;
      void this.fetchOnce();
    }, delay);
  }

  @postConstruct()
  init(): void {
    this.pruneStaleEntries();
    this.agentService.on(AgentServiceEvent.LlmActivity, this.onLlmActivity);
    // Bootstrap so the UI doesn't show null until the first agent turn.
    void this.fetchOnce();
    this.scheduleBackstop();
  }

  @preDestroy()
  stop(): void {
    this.agentService.off(AgentServiceEvent.LlmActivity, this.onLlmActivity);
    if (this.backstopTimeoutId) {
      clearTimeout(this.backstopTimeoutId);
      this.backstopTimeoutId = null;
    }
    if (this.coalesceTimeoutId) {
      clearTimeout(this.coalesceTimeoutId);
      this.coalesceTimeoutId = null;
    }
  }

  async fetchOnce(): Promise<UsageOutput | null> {
    if (this.isFetching) return null;
    this.isFetching = true;
    this.lastFetchStartedAt = Date.now();
    // Any pending coalesced fetch is satisfied by this one — drop it so the
    // backstop and refreshNow() paths don't trigger a redundant follow-up.
    if (this.coalesceTimeoutId) {
      clearTimeout(this.coalesceTimeoutId);
      this.coalesceTimeoutId = null;
    }
    try {
      const usage = await this.fetchUsageQuietly();
      if (usage) {
        const changed = !isSameUsage(this.latestUsage, usage);
        this.latestUsage = usage;
        if (changed) {
          this.emit(UsageMonitorEvent.UsageUpdated, usage);
        }
        this.processUsage(usage);
      }
      return usage;
    } finally {
      this.isFetching = false;
    }
  }

  private async fetchUsageQuietly(): Promise<UsageOutput | null> {
    try {
      return await this.llmGateway.fetchUsage();
    } catch (err) {
      log.debug("Usage fetch skipped", {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  private scheduleBackstop(): void {
    this.backstopTimeoutId = setTimeout(async () => {
      this.backstopTimeoutId = null;
      await this.fetchOnce();
      this.scheduleBackstop();
    }, BACKSTOP_INTERVAL_MS);
  }

  private processUsage(usage: UsageOutput): void {
    const userId = usage.user_id.toString();
    const product = usage.product;
    // Plan-key isn't on UsageOutput; the only signal we have client-side is
    // whether limits are at the Pro tier — but fetchUsage doesn't return that
    // either. Best-effort: assume Pro if billing_period_end is present
    // (free users never have it).
    const isPro = !!usage.billing_period_end;

    this.maybeEmit(usage, "burst", usage.burst, userId, product, isPro);
    this.maybeEmit(usage, "sustained", usage.sustained, userId, product, isPro);
  }

  private maybeEmit(
    usage: UsageOutput,
    bucket: BucketName,
    status: UsageBucket,
    userId: string,
    product: string,
    isPro: boolean,
  ): void {
    const anchor = this.anchorFor(bucket, status, usage);
    if (!anchor) return;

    const threshold = highestThresholdCrossed(status.used_percent);
    if (threshold === null) return;

    const key = makeKey(userId, product, bucket, anchor, threshold);
    if (this.thresholdsSeen[key]) return;

    this.thresholdsSeen[key] = anchor;
    usageMonitorStore.set("thresholdsSeen", this.thresholdsSeen);

    log.info("Usage threshold crossed", {
      bucket,
      threshold,
      usedPercent: status.used_percent,
    });

    this.emit(UsageMonitorEvent.ThresholdCrossed, {
      bucket,
      threshold,
      usedPercent: status.used_percent,
      resetAt: status.reset_at ?? null,
      resetsInSeconds: status.resets_in_seconds,
      isPro,
    });
  }

  // Burst anchor rounds reset_at to the hour so transient TTL jitter doesn't
  // make every poll look like a new window. Sustained anchor is the billing
  // period end (Pro) or the reset_at ISO date (free).
  private anchorFor(
    bucket: BucketName,
    status: UsageBucket,
    usage: UsageOutput,
  ): string | null {
    if (bucket === "sustained") {
      return usage.billing_period_end ?? sustainedFreeAnchor(status) ?? null;
    }
    return burstAnchor(status);
  }

  private pruneStaleEntries(): void {
    const now = Date.now();
    let dirty = false;
    for (const [key, anchor] of Object.entries(this.thresholdsSeen)) {
      const parsed = Date.parse(anchor);
      if (Number.isNaN(parsed) || parsed < now) {
        delete this.thresholdsSeen[key];
        dirty = true;
      }
    }
    if (dirty) {
      usageMonitorStore.set("thresholdsSeen", this.thresholdsSeen);
    }
  }
}

function highestThresholdCrossed(usedPercent: number): UsageThreshold | null {
  for (let i = USAGE_THRESHOLDS.length - 1; i >= 0; i--) {
    const t = USAGE_THRESHOLDS[i];
    if (usedPercent >= t) return t;
  }
  return null;
}

function burstAnchor(status: UsageBucket): string | null {
  const resetMs = resetMillis(status);
  if (resetMs === null) return null;
  // Round to the nearest hour so 30s polling doesn't churn the anchor.
  const rounded = Math.round(resetMs / 3_600_000) * 3_600_000;
  return new Date(rounded).toISOString();
}

function sustainedFreeAnchor(status: UsageBucket): string | null {
  const resetMs = resetMillis(status);
  if (resetMs === null) return null;
  return new Date(resetMs).toISOString().slice(0, 10);
}

function resetMillis(status: UsageBucket): number | null {
  if (status.reset_at) {
    const parsed = Date.parse(status.reset_at);
    if (!Number.isNaN(parsed)) return parsed;
  }
  if (status.resets_in_seconds > 0) {
    return Date.now() + status.resets_in_seconds * 1000;
  }
  return null;
}

function makeKey(
  userId: string,
  product: string,
  bucket: BucketName,
  anchor: string,
  threshold: UsageThreshold,
): string {
  return `${userId}:${product}:${bucket}:${anchor}:${threshold}`;
}

function isSameUsage(a: UsageOutput | null, b: UsageOutput): boolean {
  if (!a) return false;
  return (
    a.is_rate_limited === b.is_rate_limited &&
    a.billing_period_end === b.billing_period_end &&
    isSameBucket(a.burst, b.burst) &&
    isSameBucket(a.sustained, b.sustained)
  );
}

function isSameBucket(a: UsageBucket, b: UsageBucket): boolean {
  return (
    a.used_percent === b.used_percent &&
    a.resets_in_seconds === b.resets_in_seconds &&
    a.reset_at === b.reset_at &&
    a.exceeded === b.exceeded
  );
}
