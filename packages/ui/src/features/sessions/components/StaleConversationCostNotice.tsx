import { Warning } from "@phosphor-icons/react";
import { formatRelativeTimeLong } from "@posthog/shared";
import { formatTokensCompact } from "@posthog/ui/features/sessions/contextColors";
import { Box, Button, Flex, Text } from "@radix-ui/themes";

interface StaleConversationCostNoticeProps {
  usedTokens: number;
  lastActivityAt: number | null;
  /** Cumulative session cost so far, when the gateway reports it. */
  costUsd: number | null;
  onContinue: () => void;
  /** Compact the thread: pay the reload once, then every later turn is smaller. */
  onCompact: () => void;
  onNewSession?: () => void;
}

/**
 * Blocking overlay shown over the chat window when PostHog staff return to a
 * large, idle conversation whose prompt cache has likely expired. Covers the
 * thread and composer so the user must choose before continuing.
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
  return (
    <Flex
      align="center"
      justify="center"
      position="absolute"
      inset="0"
      p="4"
      className="z-40 bg-(--color-overlay)"
    >
      <Box
        p="4"
        className="max-w-[460px] rounded-3 border border-(--gray-6) bg-(--color-panel-solid) shadow-5"
      >
        <Flex align="center" gap="2" mb="2">
          <Warning size={18} weight="fill" color="var(--orange-9)" />
          <Text weight="bold" className="text-base">
            Continue this large, idle conversation?
          </Text>
        </Flex>
        <Text as="p" color="gray" className="text-sm">
          This conversation holds about {formatTokensCompact(usedTokens)} tokens
          and {activity}. Its prompt cache has likely expired, so your next
          message re-processes the whole conversation at full input price
          instead of the ~10% cached rate
          {costUsd !== null ? ` (≈$${costUsd.toFixed(2)} spent so far)` : ""}.
          Starting a new session avoids the cost entirely. Compacting pays the
          reload once but summarizes the thread, so every later turn is cheaper.
          Continue as-is only if you need the full context.
        </Text>
        <Flex justify="end" gap="2" mt="4">
          {onNewSession && (
            <Button variant="soft" color="gray" size="1" onClick={onNewSession}>
              Start a new session
            </Button>
          )}
          <Button variant="soft" size="1" onClick={onContinue}>
            Continue anyway
          </Button>
          <Button variant="solid" size="1" onClick={onCompact}>
            Compact and continue
          </Button>
        </Flex>
      </Box>
    </Flex>
  );
}
