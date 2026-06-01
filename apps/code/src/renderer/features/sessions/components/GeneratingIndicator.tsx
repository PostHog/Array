import { Brain, Circle, WifiSlash } from "@phosphor-icons/react";
import { Flex, Text } from "@radix-ui/themes";
import { useEffect, useRef, useState } from "react";

const THINKING_MESSAGES = [
  "Booping",
  "Crunching",
  "Digging",
  "Fetching",
  "Inferring",
  "Indexing",
  "Juggling",
  "Noodling",
  "Peeking",
  "Percolating",
  "Poking",
  "Pondering",
  "Scanning",
  "Scrambling",
  "Sifting",
  "Sniffing",
  "Spelunking",
  "Tinkering",
  "Unraveling",
  "Decoding",
  "Trekking",
  "Sorting",
  "Trimming",
  "Mulling",
  "Surfacing",
  "Rummaging",
  "Scouting",
  "Scouring",
  "Threading",
  "Hunting",
  "Swizzling",
  "Grokking",
  "Hedging",
  "Scheming",
  "Unfurling",
  "Puzzling",
  "Dissecting",
  "Stacking",
  "Snuffling",
  "Hashing",
  "Clustering",
  "Teasing",
  "Cranking",
  "Merging",
  "Snooping",
  "Rewiring",
  "Bundling",
  "Linking",
  "Mapping",
  "Tickling",
  "Flicking",
  "Hopping",
  "Rolling",
  "Zipping",
  "Twisting",
  "Blooming",
  "Sparking",
  "Nesting",
  "Looping",
  "Wiring",
  "Snipping",
  "Zoning",
  "Tracing",
  "Warping",
  "Twinkling",
  "Flipping",
  "Priming",
  "Snagging",
  "Scuttling",
  "Framing",
  "Sharpening",
  "Flibbertigibbeting",
  "Kerfuffling",
  "Dithering",
  "Discombobulating",
  "Rambling",
  "Befuddling",
  "Waffling",
  "Muckling",
  "Hobnobbing",
  "Galumphing",
  "Puttering",
  "Whiffling",
  "Thinking",
];

function getRandomThinkingMessage(): string {
  return THINKING_MESSAGES[
    Math.floor(Math.random() * THINKING_MESSAGES.length)
  ];
}

export function formatDuration(ms: number, fractionDigits = 2): string {
  const totalSeconds = Math.floor(ms / 1000);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;

  if (mins > 0) {
    return `${mins}m ${secs.toString().padStart(2, "0")}s`;
  }

  if (fractionDigits <= 0) {
    return `${secs}s`;
  }

  const fractionalUnit = 10 ** (3 - fractionDigits);
  const fractionalValue = Math.floor((ms % 1000) / fractionalUnit);

  return `${secs}.${fractionalValue.toString().padStart(fractionDigits, "0")}s`;
}

// After this long with no stream activity we hint that the wait may be the
// network rather than the agent, addressing the "long lead time with no sign
// it's the user's internet" report.
const SLOW_HINT_MS = 8000;

interface GeneratingIndicatorProps {
  /** Timestamp (ms) when the prompt started. Only render this component while a prompt is pending. */
  startedAt?: number | null;
  /** Accumulated time (ms) spent waiting for user input, subtracted from elapsed display. */
  pausedDurationMs?: number;
  /**
   * A value that changes whenever stream activity arrives (e.g. the session's
   * event count). When provided, a slow-connection hint appears if no activity
   * is seen for `slowHintMs`, and clears as soon as it changes again. Omit to
   * disable the hint entirely.
   */
  activitySignal?: number;
  /** How long to wait with no activity before hinting at a slow connection. */
  slowHintMs?: number;
  /**
   * When false, the turn can't make progress because the device is offline, so
   * we show a "waiting to reconnect" state instead of the thinking activity.
   */
  isOnline?: boolean;
}

export function GeneratingIndicator({
  startedAt,
  pausedDurationMs,
  activitySignal,
  slowHintMs = SLOW_HINT_MS,
  isOnline = true,
}: GeneratingIndicatorProps) {
  const [elapsed, setElapsed] = useState(0);
  const [activity, setActivity] = useState(getRandomThinkingMessage);
  const [isSlow, setIsSlow] = useState(false);
  // Time spent in the current offline stretch, so the reconnect indicator
  // counts from when the connection dropped — not from the turn's start.
  const [offlineElapsed, setOfflineElapsed] = useState(0);
  const offlineSinceRef = useRef<number | null>(null);

  const pausedRef = useRef(pausedDurationMs ?? 0);
  pausedRef.current = pausedDurationMs ?? 0;

  useEffect(() => {
    if (isOnline) {
      offlineSinceRef.current = null;
      setOfflineElapsed(0);
    } else if (offlineSinceRef.current === null) {
      offlineSinceRef.current = Date.now();
    }
  }, [isOnline]);

  // Timestamp of the most recent stream activity; resets the slow-hint timer.
  const lastActivityRef = useRef(Date.now());
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally keyed on activitySignal to mark each new activity.
  useEffect(() => {
    lastActivityRef.current = Date.now();
    setIsSlow(false);
  }, [activitySignal]);

  useEffect(() => {
    const startTime = startedAt ?? Date.now();
    const interval = setInterval(() => {
      setElapsed(Math.max(0, Date.now() - startTime - pausedRef.current));
      if (activitySignal !== undefined) {
        setIsSlow(Date.now() - lastActivityRef.current >= slowHintMs);
      }
      if (offlineSinceRef.current !== null) {
        setOfflineElapsed(Date.now() - offlineSinceRef.current);
      }
    }, 50);

    return () => clearInterval(interval);
  }, [startedAt, activitySignal, slowHintMs]);

  useEffect(() => {
    const interval = setInterval(() => {
      setActivity(getRandomThinkingMessage());
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  if (!isOnline) {
    return (
      <Flex
        align="center"
        gap="2"
        className="select-none"
        style={{ WebkitUserSelect: "none" }}
      >
        <WifiSlash size={12} className="text-amber-11" />
        <Text className="text-[13px] text-amber-11">
          Connection lost — waiting to reconnect…
        </Text>
        <Text color="gray" className="text-[13px]">
          (Esc to stop
        </Text>
        <Circle size={4} weight="fill" className="mx-[2px] my-0 text-gray-9" />
        <Text
          color="gray"
          style={{ fontVariantNumeric: "tabular-nums" }}
          className="text-[13px]"
        >
          {formatDuration(offlineElapsed, 1)})
        </Text>
      </Flex>
    );
  }

  return (
    <Flex
      align="center"
      gap="2"
      className="select-none select-none"
      style={{ WebkitUserSelect: "none" }}
    >
      <Brain size={12} className="ph-pulse" />
      <Text className="text-[13px] text-accent-11">{activity}...</Text>
      <Text color="gray" className="text-[13px]">
        (Esc to stop
      </Text>
      <Circle size={4} weight="fill" className="mx-[2px] my-0 text-gray-9" />
      <Text
        color="gray"
        style={{ fontVariantNumeric: "tabular-nums" }}
        className="text-[13px]"
      >
        {formatDuration(elapsed, 1)})
      </Text>
      {isSlow && (
        <>
          <Circle
            size={4}
            weight="fill"
            className="mx-[2px] my-0 text-gray-9"
          />
          <Text color="amber" className="text-[13px]">
            Slow connection? Still trying…
          </Text>
        </>
      )}
    </Flex>
  );
}
