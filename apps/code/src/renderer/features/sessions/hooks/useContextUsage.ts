import type { AcpMessage } from "@shared/types/session-events";
import { useMemo } from "react";

// Duplicated rather than imported from `packages/agent` to keep the renderer
// off that dep; lift into `@posthog/shared` if the shape drifts.
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

/**
 * Extract the latest context window usage from session events.
 * Scans backwards to find the most recent usage_update notification.
 * Re-derives on each new event, giving live updates during streaming.
 */
export function useContextUsage(events: AcpMessage[]): ContextUsage | null {
  return useMemo(() => extractContextUsage(events), [events]);
}

export function extractContextUsage(events: AcpMessage[]): ContextUsage | null {
  let aggregate: Omit<ContextUsage, "breakdown"> | null = null;
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

function extractAggregate(
  msg: AcpMessage["message"],
): Omit<ContextUsage, "breakdown"> | null {
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
  // Method may be received as either `_posthog/usage_update` or
  // `__posthog/usage_update` depending on how the transport stringifies it
  // (see acp-extensions.ts:matchesExt).
  if (
    msg.method !== "_posthog/usage_update" &&
    msg.method !== "__posthog/usage_update"
  ) {
    return null;
  }
  const params = msg.params as { breakdown?: ContextBreakdown } | undefined;
  return params?.breakdown ?? null;
}
