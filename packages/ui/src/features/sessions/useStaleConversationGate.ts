import {
  extractLastActivityAt,
  shouldWarnStaleCostlyConversation,
} from "@posthog/core/sessions/contextUsage";
import type { AcpMessage } from "@posthog/shared";
import { useMeQuery } from "@posthog/ui/features/auth/useMeQuery";
import { useContextUsage } from "@posthog/ui/features/sessions/hooks/useContextUsage";
import { useStaleConversationGateStore } from "@posthog/ui/features/sessions/staleConversationGateStore";
import { useCallback, useState } from "react";

export interface StaleConversationGate {
  /** Gate engaged — grey out the composer and require acknowledgement. */
  active: boolean;
  /** Show the blocking cost dialog. */
  dialogOpen: boolean;
  /** Gate engaged but the dialog was dismissed — show a reopen affordance. */
  dismissed: boolean;
  usedTokens: number;
  lastActivityAt: number | null;
  costUsd: number | null;
  /** "Continue anyway" — permanently acknowledge the warning for this session. */
  onContinue: () => void;
  /** Controlled open handler for the dialog (Escape / overlay / Cancel). */
  onDialogOpenChange: (open: boolean) => void;
  /** Reopen the dialog after it was dismissed. */
  onReopen: () => void;
}

/**
 * Gates continuation of a large, idle conversation for PostHog staff, whose
 * Anthropic prompt cache has likely expired (see
 * {@link shouldWarnStaleCostlyConversation}). Mirrors `useBranchMismatchDialog`:
 * composes view state and keeps the decision in core, so `SessionView` stays a
 * composition root.
 */
export function useStaleConversationGate(
  sessionId: string,
  events: AcpMessage[],
): StaleConversationGate {
  const contextUsage = useContextUsage(events);
  const { data: currentUser } = useMeQuery();
  const isStaff = currentUser?.is_staff === true;
  const acknowledged = useStaleConversationGateStore((s) =>
    s.acknowledgedSessions.has(sessionId),
  );
  const acknowledge = useStaleConversationGateStore((s) => s.acknowledge);

  const usedTokens = contextUsage?.used ?? 0;
  const lastActivityAt = extractLastActivityAt(events);
  const active =
    isStaff &&
    !acknowledged &&
    shouldWarnStaleCostlyConversation({
      usedTokens,
      lastActivityAt,
      now: Date.now(),
    });

  // Which session the dialog was dismissed for — keyed by id so switching to a
  // different gated session re-opens it without a reset effect.
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const dismissed = active && dismissedFor === sessionId;

  const onContinue = useCallback(
    () => acknowledge(sessionId),
    [acknowledge, sessionId],
  );
  const onDialogOpenChange = useCallback(
    (open: boolean) => setDismissedFor(open ? null : sessionId),
    [sessionId],
  );
  const onReopen = useCallback(() => setDismissedFor(null), []);

  return {
    active,
    dialogOpen: active && !dismissed,
    dismissed,
    usedTokens,
    lastActivityAt,
    costUsd: contextUsage?.cost?.amount ?? null,
    onContinue,
    onDialogOpenChange,
    onReopen,
  };
}
