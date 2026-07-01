import {
  type ContextBreakdownBaseline,
  emptyBaseline,
} from "../claude/context-breakdown";
import type { AccumulatedUsage } from "./ext-notifications";

/** The live `_posthog/usage_update` fields (context-window occupancy). */
export interface UsageUpdate {
  used: number;
  size: number | null;
  usage: {
    inputTokens?: number;
    outputTokens?: number;
    cachedReadTokens?: number;
    reasoningTokens?: number;
    totalTokens?: number;
  };
}

/**
 * Tracks token usage for one codex thread.
 *
 * codex's `thread/tokenUsage/updated` carries `{ total (cumulative), last (this
 * turn's breakdown), modelContextWindow }`. We let codex own the per-turn number
 * rather than reconstructing it: `last` is both the context-window occupancy (as
 * input tokens) and the per-turn usage reported on `_posthog/turn_complete` — so
 * there's no cumulative snapshot to diff. `total` is only a fallback for a build
 * that predates `last` (turn one, where `last` ≈ `total`).
 */
export class UsageTracker {
  private baseline: ContextBreakdownBaseline = emptyBaseline();
  private lastTurn?: AccumulatedUsage;
  private contextUsed?: number;

  setBaseline(baseline: ContextBreakdownBaseline): void {
    this.baseline = baseline;
  }

  get baselineBreakdown(): ContextBreakdownBaseline {
    return this.baseline;
  }

  /** Zero the per-turn view at turn start so a token-less turn reports 0. */
  resetForTurn(): void {
    this.lastTurn = undefined;
    this.contextUsed = undefined;
  }

  /**
   * Ingest a `thread/tokenUsage/updated` payload; returns the live usage_update
   * to emit, or null if the payload has no usable totals.
   */
  ingest(params: unknown): UsageUpdate | null {
    const tu = (params as { tokenUsage?: any })?.tokenUsage;
    const total = tu?.total;
    if (!total) return null;
    const context = tu.last ?? total;
    // Drives the per-source breakdown's "conversation" bucket on turn complete.
    this.contextUsed = context.inputTokens ?? context.totalTokens;
    this.lastTurn = {
      inputTokens: context.inputTokens ?? 0,
      outputTokens: context.outputTokens ?? 0,
      cachedReadTokens: context.cachedInputTokens ?? 0,
      // codex's TokenUsageBreakdown has no cache-write field; 0 is authoritative.
      cachedWriteTokens: 0,
    };
    return {
      used: context.totalTokens,
      size: tu.modelContextWindow ?? null,
      usage: {
        inputTokens: context.inputTokens,
        outputTokens: context.outputTokens,
        cachedReadTokens: context.cachedInputTokens,
        reasoningTokens: context.reasoningOutputTokens,
        totalTokens: context.totalTokens,
      },
    };
  }

  /** Per-turn usage for `_posthog/turn_complete` — codex's `last`, not a delta. */
  perTurnUsage(): AccumulatedUsage {
    return (
      this.lastTurn ?? {
        inputTokens: 0,
        outputTokens: 0,
        cachedReadTokens: 0,
        cachedWriteTokens: 0,
      }
    );
  }

  /** Live context occupancy (last turn's input tokens), or undefined pre-usage. */
  contextTokens(): number | undefined {
    return this.contextUsed;
  }
}
