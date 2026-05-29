import type { AcpMessage } from "@posthog/shared";

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
  if (
    msg.method !== "_posthog/usage_update" &&
    msg.method !== "__posthog/usage_update"
  ) {
    return null;
  }
  const params = msg.params as { breakdown?: ContextBreakdown } | undefined;
  return params?.breakdown ?? null;
}
