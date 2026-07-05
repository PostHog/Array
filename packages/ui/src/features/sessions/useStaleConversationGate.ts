import {
  extractLastActivityAt,
  shouldWarnStaleCostlyConversation,
} from "@posthog/core/sessions/contextUsage";
import type { AcpMessage } from "@posthog/shared";
import { useMeQuery } from "@posthog/ui/features/auth/useMeQuery";
import { useContextUsage } from "@posthog/ui/features/sessions/hooks/useContextUsage";
import { useStaleConversationGateStore } from "@posthog/ui/features/sessions/staleConversationGateStore";
import { useCallback, useEffect } from "react";

export interface StaleConversationGate {
  /** Gate engaged — block the conversation until the user chooses. */
  active: boolean;
  usedTokens: number;
  /** Last activity as observed when the gate engaged, not the live value. */
  lastActivityAt: number | null;
  costUsd: number | null;
  /** "Continue anyway" — permanently acknowledge the warning for this session. */
  onContinue: () => void;
}

/**
 * Gates continuation of a large, idle conversation for PostHog staff, whose
 * Anthropic prompt cache has likely expired (see
 * {@link shouldWarnStaleCostlyConversation}).
 *
 * The gate latches: opening a stale session reconnects the agent, which
 * immediately emits freshly-stamped events (usage updates, handshakes), so
 * the raw staleness check flips back off before the user has seen the
 * warning. Once engaged, only acknowledging releases it.
 */
export function useStaleConversationGate(
  sessionId: string,
  events: AcpMessage[],
): StaleConversationGate {
  const contextUsage = useContextUsage(events);
  const { data: currentUser } = useMeQuery();
  const isStaff = currentUser?.is_staff === true;
  const engaged = useStaleConversationGateStore((s) =>
    s.engagedSessions.has(sessionId),
  );
  const engagedLastActivityAt = useStaleConversationGateStore((s) =>
    s.engagedSessions.get(sessionId),
  );
  const acknowledged = useStaleConversationGateStore((s) =>
    s.acknowledgedSessions.has(sessionId),
  );
  const engage = useStaleConversationGateStore((s) => s.engage);
  const acknowledge = useStaleConversationGateStore((s) => s.acknowledge);

  const usedTokens = contextUsage?.used ?? 0;
  const liveLastActivityAt = extractLastActivityAt(events);
  const shouldEngage =
    isStaff &&
    !acknowledged &&
    shouldWarnStaleCostlyConversation({
      usedTokens,
      lastActivityAt: liveLastActivityAt,
      now: Date.now(),
    });

  useEffect(() => {
    if (shouldEngage) engage(sessionId, liveLastActivityAt);
  }, [shouldEngage, engage, sessionId, liveLastActivityAt]);

  const onContinue = useCallback(
    () => acknowledge(sessionId),
    [acknowledge, sessionId],
  );

  return {
    // shouldEngage covers the first paint before the effect latches;
    // engaged covers every render after (reconnect events flip
    // shouldEngage back off — see the hook doc).
    active: shouldEngage || engaged,
    usedTokens,
    lastActivityAt: engaged
      ? (engagedLastActivityAt ?? null)
      : liveLastActivityAt,
    costUsd: contextUsage?.cost?.amount ?? null,
    onContinue,
  };
}
