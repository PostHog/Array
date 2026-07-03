import { Warning } from "@phosphor-icons/react";
import { AlertDialog, Button, Flex } from "@radix-ui/themes";

interface StaleConversationCostDialogProps {
  open: boolean;
  usedTokens: number;
  idleMs: number;
  /** Cumulative session cost so far, when the gateway reports it. */
  costUsd: number | null;
  onContinue: () => void;
  onOpenChange: (open: boolean) => void;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
  return `${tokens}`;
}

function formatIdle(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

export function StaleConversationCostDialog({
  open,
  usedTokens,
  idleMs,
  costUsd,
  onContinue,
  onOpenChange,
}: StaleConversationCostDialogProps) {
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
          This conversation holds about {formatTokens(usedTokens)} tokens and
          has been idle for {formatIdle(idleMs)}. Its prompt cache has likely
          expired, so your next message re-processes the whole conversation at
          full input price instead of the ~10% cached rate
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
