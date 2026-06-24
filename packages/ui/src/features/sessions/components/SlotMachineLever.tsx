import { useSettingsStore } from "@posthog/ui/features/settings/settingsStore";
import { Box, Flex, Tooltip } from "@radix-ui/themes";
import { motion, useAnimationControls } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";

/** Reel faces. The hedgehog is the jackpot symbol. */
const REEL_SYMBOLS = ["🍒", "🍋", "🔔", "⭐", "💎", "7️⃣", "🦔"] as const;

function randomSymbol(): string {
  return REEL_SYMBOLS[Math.floor(Math.random() * REEL_SYMBOLS.length)];
}

function randomReels(): [string, string, string] {
  return [randomSymbol(), randomSymbol(), randomSymbol()];
}

interface SlotMachineLeverProps {
  /** Whether the agent is actively generating — the reels spin while it is. */
  spinning: boolean;
}

/**
 * Easter egg gated behind the `slotMachineMode` setting: a tiny slot machine
 * whose reels spin while a task runs. Three hedgehogs is the jackpot.
 */
export function SlotMachineLever({ spinning }: SlotMachineLeverProps) {
  const enabled = useSettingsStore((state) => state.slotMachineMode);
  const [reels, setReels] = useState<[string, string, string]>(randomReels);
  const [pullSpin, setPullSpin] = useState(false);
  const lever = useAnimationControls();
  const pullSpinTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isSpinning = enabled && (spinning || pullSpin);

  // Clear any pending pull-spin timer on unmount so it doesn't fire against
  // stale state after the session ends.
  useEffect(() => {
    return () => {
      if (pullSpinTimeout.current !== null) {
        clearTimeout(pullSpinTimeout.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isSpinning) return;
    const id = setInterval(() => {
      setReels(randomReels());
    }, 90);
    return () => clearInterval(id);
  }, [isSpinning]);

  const pull = useCallback(() => {
    void lever.start({
      rotate: [0, 26, 0],
      transition: { duration: 0.55, times: [0, 0.32, 1], ease: "easeInOut" },
    });
    setPullSpin(true);
    // Restart the timer on each pull so rapid clicks keep the reels spinning
    // until 800ms after the most recent press.
    if (pullSpinTimeout.current !== null) {
      clearTimeout(pullSpinTimeout.current);
    }
    pullSpinTimeout.current = setTimeout(() => setPullSpin(false), 800);
  }, [lever]);

  if (!enabled) return null;

  const jackpot = !isSpinning && reels.every((symbol) => symbol === "🦔");

  return (
    <Flex
      align="center"
      gap="1"
      className="shrink-0 select-none"
      style={{ WebkitUserSelect: "none" }}
    >
      <Flex
        align="center"
        gap="1"
        className={`rounded-sm border border-gray-6 bg-gray-2 px-1 py-[1px] ${
          jackpot ? "animate-pulse" : ""
        }`}
      >
        {reels.map((symbol, index) => (
          <motion.span
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed 3-reel layout
            key={index}
            animate={isSpinning ? { y: [-1, 1, -1] } : { y: 0 }}
            transition={
              isSpinning
                ? { duration: 0.18, repeat: Infinity, ease: "linear" }
                : { type: "spring", stiffness: 500, damping: 18 }
            }
            className="w-[14px] text-center text-[12px] leading-none"
          >
            {symbol}
          </motion.span>
        ))}
      </Flex>

      <Tooltip content="Pull to gamble on your task 🎰">
        <button
          type="button"
          onClick={pull}
          aria-label="Pull the slot machine lever"
          className="relative flex h-[18px] w-[10px] items-center justify-center"
        >
          <motion.div
            animate={lever}
            style={{ originY: 1, originX: 0.5 }}
            className="flex h-full flex-col items-center"
          >
            <Box className="h-[6px] w-[6px] rounded-full bg-red-9" />
            <Box className="w-[2px] flex-1 bg-gray-8" />
          </motion.div>
        </button>
      </Tooltip>
    </Flex>
  );
}
