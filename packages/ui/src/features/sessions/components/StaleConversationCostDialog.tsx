import { Warning } from "@phosphor-icons/react";
import { formatRelativeTimeLong } from "@posthog/shared";
import { formatTokensCompact } from "@posthog/ui/features/sessions/contextColors";
import { AlertDialog, Button, Flex } from "@radix-ui/themes";

interface StaleConversationCostDialogProps {
  open: boolean;
  usedTokens: number;
  lastActivityAt: number | null;
  /** Cumulative session cost so far, when the gateway reports it. */
  costUsd: number | null;
  onContinue: () => void;
  onOpenChange: (open: boolean) => void;
}

export function StaleConversationCostDialog({
  open,
  usedTokens,
  lastActivityAt,
  costUsd,
  onContinue,
  onOpenChange,
}: StaleConversationCostDialogProps) {
  const activity =
    lastActivityAt !== null
      ? `was last active ${formatRelativeTimeLong(lastActivityAt)}`
      : "has been idle";
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Content maxWidth="460px" size="2">
        <AlertDialog.Title className="text-base">
          <Flex align="center" gap="2">
            <Warning size={18} weight="fill" color="var(--orange-9)" />
            Continue this large, idle conversation?
          </Flex>
        </AlertDialog.Title>
        <AlertDialog.Description className="text-sm">
          This conversation holds about {formatTokensCompact(usedTokens)} tokens
          and {activity}. Its prompt cache has likely expired, so your next
          message re-processes the whole conversation at full input price
          instead of the ~10% cached rate
          {costUsd !== null ? ` (≈$${costUsd.toFixed(2)} spent so far)` : ""}.
          Starting a new conversation avoids the cost — continue only if you
          need this thread's context.
        </AlertDialog.Description>

        <Flex justify="end" gap="2" mt="4">
          <AlertDialog.Cancel>
            <Button variant="soft" color="gray" size="1">
              Not now
            </Button>
          </AlertDialog.Cancel>
          <AlertDialog.Action>
            <Button variant="solid" size="1" onClick={onContinue}>
              Continue anyway
            </Button>
          </AlertDialog.Action>
        </Flex>
      </AlertDialog.Content>
    </AlertDialog.Root>
  );
}
