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
   * Minimum idle time (ms) before a conversation counts as "stale". See
   * {@link DEFAULT_STALE_COSTLY_THRESHOLD} for how this bound is chosen.
   */
  staleMs: number;
}

/**
 * Defaults for the stale-costly conversation warning.
 *
 * `tokens` (100k): only conversations big enough that a cold prefix rebuild is
 * a real cost — roughly 10% of the 1M context window — trip the warning.
 *
 * `staleMs` (60 min): Anthropic ephemeral caches default to a 5-minute TTL and
 * can opt into a 1-hour one; the effective value depends on what the Agent SDK
 * requests, which we don't control or observe. We deliberately use the longer
 * 1-hour bound so the cache is almost certainly cold before we warn — warning
 * while it is still warm would nag about a continuation that is in fact cheap,
 * the worse failure. Erring long only means we occasionally skip a warning,
 * never that we nag needlessly.
 */
export const DEFAULT_STALE_COSTLY_THRESHOLD: StaleCostlyThreshold = {
  tokens: 100_000,
  staleMs: 60 * 60 * 1000,
};

/**
 * Decide whether to warn that continuing a conversation will be costly: true
 * when it is both large (>= `threshold.tokens`) and stale (idle >=
 * `threshold.staleMs`). See {@link DEFAULT_STALE_COSTLY_THRESHOLD} for the
 * pricing rationale behind the defaults.
 *
 * Pure and time-injected (no `Date.now()`). A `null` `lastActivityAt` never
 * warns, and a future timestamp (clock skew) reads as fresh.
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

/**
 * Best-effort "time of last activity" for a session: the most recent (maximum)
 * `ts` among events, or null for an empty list. Scans for the max rather than
 * trusting positional order, so an out-of-order append can't report a staler
 * time than reality. (Uses a loop, not the spread form of `Math.max`, which can
 * overflow the stack on long event lists.) Heuristic proxy for prompt-cache
 * freshness — `ts` is stamped on *any* AcpMessage (agent chunks, tool calls,
 * client-side events), not only turns sent to the model. Good enough for a soft
 * cost warning; not a billing signal.
 */
export function extractLastActivityAt(events: AcpMessage[]): number | null {
  if (events.length === 0) return null;
  let latest = events[0].ts;
  for (let i = 1; i < events.length; i++) {
    if (events[i].ts > latest) latest = events[i].ts;
  }
  return latest;
}
