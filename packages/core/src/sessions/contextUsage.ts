import type { AcpMessage } from "@posthog/shared";
import { createAppendOnlyTracker } from "./appendOnlyTracker";

export interface ContextBreakdown {
  systemPrompt: number;
  tools: number;
  rules: number;
  skills: number;
  mcp: number;
  subagents: number;
  conversation: number;
}

export interface ContextUsage {
  used: number;
  size: number;
  percentage: number;
  cost: { amount: number; currency: string } | null;
  breakdown: ContextBreakdown | null;
}

type ContextUsageAggregate = Omit<ContextUsage, "breakdown">;

export function extractContextUsage(events: AcpMessage[]): ContextUsage | null {
  let aggregate: ContextUsageAggregate | null = null;
  let breakdown: ContextBreakdown | null = null;

  for (let i = events.length - 1; i >= 0; i--) {
    const msg = events[i].message;
    if (!aggregate) {
      aggregate = extractAggregate(msg);
    }
    if (!breakdown) {
      breakdown = extractBreakdown(msg);
    }
    if (aggregate && breakdown) break;
  }

  if (!aggregate) return null;
  return { ...aggregate, breakdown };
}

interface ContextUsageState {
  aggregate: ContextUsageAggregate | null;
  breakdown: ContextBreakdown | null;
}

export function createContextUsageTracker() {
  return createAppendOnlyTracker<ContextUsageState, ContextUsage | null>({
    init: () => ({ aggregate: null, breakdown: null }),
    processEvent: (state, event) => {
      const msg = event.message;
      state.aggregate = extractAggregate(msg) ?? state.aggregate;
      state.breakdown = extractBreakdown(msg) ?? state.breakdown;
    },
    getResult: (state) =>
      state.aggregate
        ? { ...state.aggregate, breakdown: state.breakdown }
        : null,
  });
}

function extractAggregate(
  msg: AcpMessage["message"],
): ContextUsageAggregate | null {
  if (
    "method" in msg &&
    msg.method === "session/update" &&
    !("id" in msg) &&
    "params" in msg
  ) {
    const params = msg.params as
      | {
          update?: {
            sessionUpdate?: string;
            used?: number;
            size?: number;
            cost?: { amount: number; currency: string } | null;
          };
        }
      | undefined;
    const update = params?.update;
    if (
      update?.sessionUpdate === "usage_update" &&
      typeof update.used === "number" &&
      typeof update.size === "number"
    ) {
      const percentage =
        update.size > 0
          ? Math.min(100, Math.round((update.used / update.size) * 100))
          : 0;
      return {
        used: update.used,
        size: update.size,
        percentage,
        cost: update.cost ?? null,
      };
    }
  }
  return null;
}

function extractBreakdown(msg: AcpMessage["message"]): ContextBreakdown | null {
  if (!("method" in msg) || !("params" in msg)) return null;
  if (
    msg.method !== "_posthog/usage_update" &&
    msg.method !== "__posthog/usage_update"
  ) {
    return null;
  }
  const params = msg.params as { breakdown?: ContextBreakdown } | undefined;
  return params?.breakdown ?? null;
}

/**
 * Threshold controlling when {@link shouldWarnStaleCostlyConversation} fires.
 */
export interface StaleCostlyThreshold {
  /** Minimum context tokens for a conversation to count as "large". */
  tokens: number;
  /**
   * Minimum idle time (ms) before a conversation counts as "stale". Set to
   * roughly the Anthropic prompt-cache TTL: once the cache expires, the next
   * turn re-processes the whole prefix at full input price instead of the
   * ~10% cached-read rate.
   */
  staleMs: number;
}

/**
 * Defaults for the stale-costly conversation warning: a conversation large
 * enough that a cold cache rebuild is noticeable, left idle past the default
 * 5-minute prompt-cache TTL.
 */
export const DEFAULT_STALE_COSTLY_THRESHOLD: StaleCostlyThreshold = {
  tokens: 40_000,
  staleMs: 5 * 60 * 1000,
};

/**
 * Decide whether to warn that continuing a conversation will be costly.
 *
 * Flags a conversation that is both large (>= `threshold.tokens` of context)
 * and stale (idle >= `threshold.staleMs`). Staleness approximates whether the
 * Anthropic prompt cache has expired: continuing a stale, large conversation
 * re-sends the whole prefix at full input price rather than the cached-read
 * rate, so starting fresh is often cheaper.
 *
 * Pure and time-injected (no `Date.now()`) so it stays host-agnostic and
 * testable. A `null` `lastActivityAt` (no activity yet) never warns, and a
 * future timestamp (clock skew) reads as fresh, not stale.
 */
export function shouldWarnStaleCostlyConversation(args: {
  usedTokens: number;
  lastActivityAt: number | null;
  now: number;
  threshold?: StaleCostlyThreshold;
}): boolean {
  const { usedTokens, lastActivityAt, now } = args;
  const threshold = args.threshold ?? DEFAULT_STALE_COSTLY_THRESHOLD;
  if (lastActivityAt === null) return false;
  if (usedTokens < threshold.tokens) return false;
  return now - lastActivityAt >= threshold.staleMs;
}
