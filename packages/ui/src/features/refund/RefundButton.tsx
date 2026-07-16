import {
  CheckCircleIcon,
  CoinsIcon,
  HeartIcon,
} from "@phosphor-icons/react";
import { Button } from "@posthog/quill";
import { fireFrom } from "@posthog/ui/primitives/confetti";
import { Flex, Popover, Spinner, Text } from "@radix-ui/themes";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useCallback, useRef, useState } from "react";

type RefundState = "idle" | "refunding" | "refunded";

// PostHog gold, the colour money comes back in.
const GOLD = ["#f8be2a", "#f5a623", "#ffd75e", "#f54d00"];

interface RefundButtonProps {
  /**
   * Human-readable amount to refund, e.g. "$4.20". Shown on the confirm step
   * and floated up as a coin-return flourish once the refund lands.
   */
  amountLabel?: string;
  /**
   * Runs the actual refund. Resolve to confirm success; reject to surface an
   * error. Kept as a plain callback so the button stays host-agnostic.
   */
  onRefund: () => void | Promise<void>;
  disabled?: boolean;
}

/**
 * A refund is a different animal from every other action in the review bar:
 * it's the one that spends *less* money, not more. Rather than bury it or dress
 * it up as a scary destructive action, we lean into PostHog's philosophy — if
 * the work wasn't useful, take your money back, no hard feelings — and make the
 * moment feel *good*. Confirm honestly, then celebrate: coins fly back to you.
 *
 * Deliberately styled apart from the primary CTAs (warm gold, coin-return
 * iconography) so nobody confuses "refund" with "use the product". Respects
 * `prefers-reduced-motion` throughout.
 */
export function RefundButton({
  amountLabel,
  onRefund,
  disabled = false,
}: RefundButtonProps) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<RefundState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [showCoinFloat, setShowCoinFloat] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const reduceMotion = useReducedMotion();

  const isRefunding = state === "refunding";
  const isRefunded = state === "refunded";

  const handleConfirm = useCallback(async () => {
    setError(null);
    setState("refunding");
    try {
      await onRefund();
      setState("refunded");
      setOpen(false);
      // Coins fly back to the wallet: confetti from the button + a "+$X" drift.
      if (buttonRef.current) fireFrom(buttonRef.current, { colors: GOLD });
      setShowCoinFloat(true);
      window.setTimeout(() => setShowCoinFloat(false), 1400);
    } catch (err) {
      setState("idle");
      setError(err instanceof Error ? err.message : "Refund failed");
    }
  }, [onRefund]);

  return (
    <span className="relative inline-flex">
      {/* The coin-return flourish: amount drifts up and fades once refunded. */}
      <AnimatePresence>
        {showCoinFloat && !reduceMotion ? (
          <motion.span
            key="coin-float"
            aria-hidden
            initial={{ opacity: 0, y: 4, scale: 0.8 }}
            animate={{ opacity: 1, y: -22, scale: 1 }}
            exit={{ opacity: 0, y: -34 }}
            transition={{ duration: 1.2, ease: "easeOut" }}
            className="-top-1 -translate-x-1/2 pointer-events-none absolute left-1/2 z-20 whitespace-nowrap font-semibold text-(--yellow-11) text-xs"
          >
            +{amountLabel ?? "refund"} 🪙
          </motion.span>
        ) : null}
      </AnimatePresence>

      <Popover.Root
        open={open}
        onOpenChange={(next) => {
          // Lock the popover shut while a refund is in flight or already done.
          if (isRefunding || isRefunded) return;
          setOpen(next);
          if (!next) setError(null);
        }}
      >
        <Popover.Trigger>
          <Button
            ref={buttonRef}
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || isRefunding}
            className="group relative gap-1 overflow-hidden border-transparent transition-colors hover:border-(--yellow-8) hover:text-(--yellow-11)"
            // CSS variables / runtime colour: inline style is the sanctioned path.
            style={
              isRefunded
                ? {
                    backgroundColor: "var(--yellow-9)",
                    borderColor: "transparent",
                    color: "var(--gray-12)",
                  }
                : undefined
            }
            title={
              isRefunded ? "Refunded — thanks for the honesty" : "Refund this work"
            }
          >
            {/* Gold sheen that sweeps across on hover — the "cool" tell. */}
            {!reduceMotion && !isRefunded ? (
              <span
                aria-hidden
                className="-translate-x-full pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-(--yellow-5) to-transparent opacity-0 transition-all duration-700 ease-out group-hover:translate-x-full group-hover:opacity-100"
              />
            ) : null}

            <span className="relative z-10 flex items-center gap-1">
              {isRefunding ? (
                <Spinner size="1" />
              ) : isRefunded ? (
                <CheckCircleIcon size={13} weight="fill" />
              ) : (
                // Coin flips on hover — a little wink of money coming back.
                <motion.span
                  className="inline-flex"
                  whileHover={reduceMotion ? undefined : { rotateY: 180 }}
                  transition={{ duration: 0.4 }}
                  style={{ transformStyle: "preserve-3d" }}
                >
                  <CoinsIcon size={13} weight="duotone" />
                </motion.span>
              )}
              {isRefunding ? "Refunding…" : isRefunded ? "Refunded" : "Refund"}
            </span>
          </Button>
        </Popover.Trigger>

        <Popover.Content
          align="end"
          side="bottom"
          sideOffset={6}
          className="w-[340px] border border-(--gray-6) bg-(--color-panel-solid) p-4 shadow-6"
        >
          <Flex direction="column" gap="3">
            <Flex align="center" gap="2">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-(--yellow-4) text-(--yellow-11)">
                <CoinsIcon size={18} weight="duotone" />
              </span>
              <Text size="2" weight="bold">
                Refund{amountLabel ? ` ${amountLabel}` : ""}?
              </Text>
            </Flex>

            <Text size="1" color="gray">
              Yes, really. If PostHog's work here wasn't actually useful, take
              your money back — no hard feelings, no questions. That's our
              philosophy: you should only pay for work that helped.{" "}
              <HeartIcon
                size={11}
                weight="fill"
                className="-mt-0.5 inline text-(--red-9)"
              />
            </Text>

            {error ? (
              <Text size="1" className="text-(--red-11)">
                {error}
              </Text>
            ) : null}

            <Flex justify="end" gap="2" align="center">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setOpen(false)}
              >
                Keep it
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={isRefunding}
                onClick={handleConfirm}
                className="gap-1"
                style={{
                  backgroundColor: "var(--yellow-9)",
                  color: "var(--gray-12)",
                }}
              >
                {isRefunding ? <Spinner size="1" /> : <CoinsIcon size={13} />}
                Refund it
              </Button>
            </Flex>
          </Flex>
        </Popover.Content>
      </Popover.Root>
    </span>
  );
}
