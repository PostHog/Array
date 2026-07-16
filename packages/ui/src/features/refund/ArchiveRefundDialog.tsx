import { CoinsIcon, HeartIcon, InfoIcon } from "@phosphor-icons/react";
import { fireFrom } from "@posthog/ui/primitives/confetti";
import { Tooltip } from "@posthog/ui/primitives/Tooltip";
import {
  AlertDialog,
  Button,
  Checkbox,
  Flex,
  Spinner,
  Text,
} from "@radix-ui/themes";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useCallback, useRef, useState } from "react";

// PostHog gold, the colour money comes back in.
const GOLD = ["#f8be2a", "#f5a623", "#ffd75e", "#f54d00"];

interface ArchiveRefundDialogProps {
  /**
   * Human-readable amount that would be refunded, e.g. "$4.20". Shown next to
   * the opt-in and floated up as a coin-return flourish when a refund lands.
   */
  amountLabel?: string;
  /**
   * Archives the PR. `refund` is true when the user opted in to also getting
   * their money back. Resolve on success; reject to surface an error.
   */
  onArchive: (opts: { refund: boolean }) => void | Promise<void>;
  disabled?: boolean;
}

/**
 * One action, two intents. Archiving clears the PR from your view; refunding is
 * the psychologically opposite move — spending *less* money, not more. We keep
 * them in a single flow (you always archive; refunding is an honest opt-in)
 * instead of two confusable top-bar buttons.
 *
 * The refund opt-in is where it gets fun: tick it and a warm gold panel unfurls
 * with PostHog's "only pay for work that helped" philosophy, the confirm button
 * turns to gold, and confirming rains confetti + floats your money back up.
 * Deliberately distinct from the primary CTAs so "refund" never reads as "use
 * the product". Respects `prefers-reduced-motion` throughout.
 */
export function ArchiveRefundDialog({
  amountLabel,
  onArchive,
  disabled = false,
}: ArchiveRefundDialogProps) {
  const [open, setOpen] = useState(false);
  const [refund, setRefund] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCoinFloat, setShowCoinFloat] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const reduceMotion = useReducedMotion();

  const resetTransient = useCallback(() => {
    setError(null);
    setRefund(false);
  }, []);

  const handleConfirm = useCallback(
    async (event: React.MouseEvent) => {
      // Keep the dialog open while we work / show errors.
      event.preventDefault();
      if (isSubmitting) return;
      setError(null);
      setIsSubmitting(true);
      try {
        await onArchive({ refund });
        setOpen(false);
        if (refund) {
          // Coins fly back: confetti from the trigger + a "+$X" drift.
          if (triggerRef.current)
            fireFrom(triggerRef.current, { colors: GOLD });
          setShowCoinFloat(true);
          window.setTimeout(() => setShowCoinFloat(false), 1400);
        }
        resetTransient();
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Couldn't archive this PR. Try again in a moment.",
        );
      } finally {
        setIsSubmitting(false);
      }
    },
    [isSubmitting, onArchive, refund, resetTransient],
  );

  return (
    <span className="relative inline-flex">
      {/* Coin-return flourish: amount drifts up and fades once refunded. */}
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

      <AlertDialog.Root
        open={open}
        onOpenChange={(next) => {
          if (isSubmitting) return;
          setOpen(next);
          if (!next) resetTransient();
        }}
      >
        <AlertDialog.Trigger>
          <Button
            ref={triggerRef}
            type="button"
            variant="outline"
            size="1"
            disabled={disabled}
          >
            Archive
          </Button>
        </AlertDialog.Trigger>

        <AlertDialog.Content maxWidth="420px" size="2">
          <AlertDialog.Title className="text-base">
            Archive this PR?
          </AlertDialog.Title>
          <AlertDialog.Description className="text-sm">
            It'll move out of your inbox to the archive. You can unarchive it
            later.
          </AlertDialog.Description>

          {/* The refund opt-in — Alex's "meaningful, deliberate" choice, made
              to feel good rather than like a throwaway checkbox. */}
          <label className="mt-3 flex cursor-pointer items-center gap-2 select-none">
            <Checkbox
              checked={refund}
              onCheckedChange={(next) => setRefund(next === true)}
              disabled={isSubmitting}
            />
            <Text size="2">
              Also refund{amountLabel ? ` ${amountLabel}` : " this PR"}
            </Text>
            <Tooltip
              content="Yes, really. Feel free to refund work by PostHog that wasn't actually useful — that's our philosophy. You should only pay for work that helped."
              side="top"
            >
              <span className="inline-flex text-(--gray-9) hover:text-(--gray-11)">
                <InfoIcon size={14} />
              </span>
            </Tooltip>
          </label>

          <AnimatePresence initial={false}>
            {refund ? (
              <motion.div
                key="refund-panel"
                initial={reduceMotion ? false : { opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={reduceMotion ? undefined : { opacity: 0, height: 0 }}
                transition={{ duration: 0.25, ease: "easeOut" }}
                className="overflow-hidden"
              >
                <div className="relative mt-3 overflow-hidden rounded-md border border-(--yellow-6) bg-(--yellow-2) p-3">
                  {/* Gold sheen sweep — the "cool" tell. */}
                  {!reduceMotion ? (
                    <motion.span
                      aria-hidden
                      initial={{ x: "-120%" }}
                      animate={{ x: "120%" }}
                      transition={{
                        duration: 1.1,
                        ease: "easeInOut",
                        repeat: Number.POSITIVE_INFINITY,
                        repeatDelay: 1.4,
                      }}
                      className="pointer-events-none absolute inset-y-0 w-1/2 bg-gradient-to-r from-transparent via-(--yellow-5) to-transparent"
                    />
                  ) : null}
                  <Flex align="center" gap="2" className="relative">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-(--yellow-4) text-(--yellow-11)">
                      <CoinsIcon size={16} weight="duotone" />
                    </span>
                    <Text size="1" className="text-(--yellow-12)">
                      Nice — we'll send{" "}
                      <span className="font-semibold">
                        {amountLabel ?? "your money"}
                      </span>{" "}
                      back. No hard feelings.{" "}
                      <HeartIcon
                        size={11}
                        weight="fill"
                        className="-mt-0.5 inline text-(--red-9)"
                      />
                    </Text>
                  </Flex>
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>

          {error ? (
            <Text color="red" size="2" mt="2" as="div">
              {error}
            </Text>
          ) : null}

          <Flex justify="end" gap="2" mt="4" align="center">
            <AlertDialog.Cancel>
              <Button
                variant="soft"
                color="gray"
                size="1"
                disabled={isSubmitting}
              >
                Cancel
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button
                type="button"
                variant="solid"
                size="1"
                disabled={isSubmitting}
                onClick={handleConfirm}
                className="gap-1"
                // Runtime gold when refunding: inline style is the sanctioned
                // path for CSS-variable colours.
                style={
                  refund
                    ? {
                        backgroundColor: "var(--yellow-9)",
                        color: "var(--gray-12)",
                      }
                    : undefined
                }
              >
                {isSubmitting ? (
                  <Spinner size="1" />
                ) : refund ? (
                  <CoinsIcon size={13} />
                ) : null}
                {refund
                  ? `Archive & refund${amountLabel ? ` ${amountLabel}` : ""}`
                  : "Archive"}
              </Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </span>
  );
}
