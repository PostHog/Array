import { formatUsd } from "@posthog/core/billing/spendAnalysisFormat";
import { formatRelativeTimeLong } from "@posthog/shared";
import { formatTokensCompact } from "@posthog/ui/features/sessions/contextColors";
import { ActionSelector } from "@posthog/ui/primitives/ActionSelector";

const COMPACT_OPTION = "compact";
const CONTINUE_OPTION = "continue";
const NEW_SESSION_OPTION = "new-session";

interface StaleConversationCostNoticeProps {
  usedTokens: number;
  lastActivityAt: number | null;
  /** Cumulative session cost so far, when the gateway reports it. */
  costUsd: number | null;
  onContinue: () => void;
  /**
   * Compact the thread: pay the reload once, then every later turn is
   * smaller. Omitted while a permission is pending — a queued /compact would
   * land after answering it, paying the reload twice.
   */
  onCompact?: () => void;
  onNewSession?: () => void;
}

/**
 * Composer state shown in place of the prompt input when PostHog staff return
 * to a large, idle conversation whose prompt cache has likely expired. Uses
 * the same ActionSelector as permission prompts, so the user must choose how
 * to continue before they can type again.
 */
export function StaleConversationCostNotice({
  usedTokens,
  lastActivityAt,
  costUsd,
  onContinue,
  onCompact,
  onNewSession,
}: StaleConversationCostNoticeProps) {
  const activity =
    lastActivityAt !== null
      ? `was last active ${formatRelativeTimeLong(lastActivityAt)}`
      : "has been idle";
  const spent =
    costUsd !== null ? ` (≈${formatUsd(costUsd)} spent so far)` : "";
  return (
    <ActionSelector
      title="Continue this large, idle conversation?"
      question={`This conversation holds about ${formatTokensCompact(usedTokens)} tokens and ${activity}. Its prompt cache has likely expired, so the next message re-processes everything at full input price instead of the ~10% cached rate${spent}. How do you want to continue?`}
      options={[
        ...(onCompact
          ? [
              {
                id: COMPACT_OPTION,
                label: "Compact and continue",
                description:
                  "Pays the reload once, then every later turn is cheaper",
              },
            ]
          : []),
        {
          id: CONTINUE_OPTION,
          label: "Continue anyway",
          description: "Full-price reload, keeps the whole conversation",
        },
        ...(onNewSession
          ? [
              {
                id: NEW_SESSION_OPTION,
                label: "Start a new session",
                description: "Avoids the cost entirely",
              },
            ]
          : []),
      ]}
      onSelect={(optionId) => {
        if (optionId === COMPACT_OPTION) onCompact?.();
        else if (optionId === CONTINUE_OPTION) onContinue();
        else if (optionId === NEW_SESSION_OPTION) onNewSession?.();
      }}
    />
  );
}
