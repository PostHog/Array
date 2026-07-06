import { Warning, X } from "@phosphor-icons/react";
import { formatUsd } from "@posthog/core/billing/spendAnalysisFormat";
import { Button } from "@posthog/quill";
import { formatTokensCompact } from "@posthog/ui/features/sessions/contextColors";
import { Box, Flex, IconButton, Text, Tooltip } from "@radix-ui/themes";

interface StaleConversationCostNoticeProps {
  usedTokens: number;
  /** Cumulative session cost so far, when the gateway reports it. */
  costUsd: number | null;
  /** Dismiss the notice — "continue anyway", acknowledged for the session. */
  onDismiss: () => void;
  /**
   * Compact the thread: pay the reload once, then every later turn is
   * smaller. Omitted while a permission is pending — a queued /compact would
   * land after answering it, paying the reload twice.
   */
  onCompact?: () => void;
}

/**
 * Slim, dismissible banner pinned above the composer when PostHog staff return
 * to a large, idle conversation whose prompt cache has likely expired. Unlike a
 * permission prompt it does not take over the input box: the user can keep
 * typing and deal with (or dismiss) it whenever they like.
 */
export function StaleConversationCostNotice({
  usedTokens,
  costUsd,
  onDismiss,
  onCompact,
}: StaleConversationCostNoticeProps) {
  const spent =
    costUsd !== null ? ` (≈${formatUsd(costUsd)} spent so far)` : "";
  return (
    <Box className="mb-1 rounded-lg border border-amber-6 bg-amber-2 px-3 py-2">
      <Flex align="center" gap="2">
        <Warning size={14} weight="fill" className="shrink-0 text-amber-11" />
        <Text className="min-w-0 flex-1 text-[13px] text-gray-12">
          This conversation is large (~{formatTokensCompact(usedTokens)} tokens)
          and idle, so its prompt cache has likely expired — the next message
          re-processes everything at full input price instead of the ~10% cached
          rate{spent}.
        </Text>
        <Flex align="center" gap="1" className="shrink-0">
          {onCompact && (
            <Tooltip content="Pays the reload once, then every later turn is cheaper">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onCompact}
              >
                Compact
              </Button>
            </Tooltip>
          )}
          <Tooltip content="Dismiss — continue at full price">
            <IconButton
              size="1"
              variant="ghost"
              color="gray"
              aria-label="Dismiss cost notice"
              onClick={onDismiss}
            >
              <X size={12} />
            </IconButton>
          </Tooltip>
        </Flex>
      </Flex>
    </Box>
  );
}
