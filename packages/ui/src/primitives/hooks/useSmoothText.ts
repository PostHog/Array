import { useEffect, useRef, useState } from "react";

// Default reveal rate. Streamed LLM tokens arrive in bursty chunks; revealing
// at a steady character rate makes the text feel like it is being typed rather
// than appearing in jumps. ~120 chars/sec roughly matches a fast token stream
// while staying smooth. See https://upstash.com/blog/smooth-streaming.
const DEFAULT_CHARS_PER_SECOND = 120;

// Once the displayed text falls this far behind the target we stop easing and
// snap, so a large catch-up (e.g. a long buffered chunk) never feels sluggish.
const MAX_LAG_CHARS = 600;

/**
 * Given the current reveal length, the target length and how much time elapsed
 * since the last frame, return the next reveal length. Pure so the easing is
 * unit-testable without timers. Never exceeds `target` and never goes backwards
 * (callers handle resets when the target is replaced rather than appended).
 */
export function nextRevealLength(
  current: number,
  target: number,
  elapsedMs: number,
  charsPerSecond: number,
): number {
  if (current >= target) return target;
  if (target - current > MAX_LAG_CHARS) return target;
  const step = Math.ceil((charsPerSecond * elapsedMs) / 1000);
  return Math.min(target, current + Math.max(step, 1));
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Smoothly reveals a growing string a few characters per frame instead of
 * jumping whenever the source updates. Intended for streamed assistant text:
 * tokens are appended to `target` in bursts, and this hook animates the visible
 * prefix up to it at a steady rate.
 *
 * The text the source already had on mount is shown immediately, so re-rendered
 * history and completed messages never replay a typewriter effect. Only growth
 * that happens while mounted is animated. If the target is replaced (no longer a
 * prefix of what we were showing) or motion is reduced, it snaps.
 */
export function useSmoothText(
  target: string,
  charsPerSecond = DEFAULT_CHARS_PER_SECOND,
): string {
  // Start fully revealed: history/completed messages should not animate.
  const [revealLength, setRevealLength] = useState(target.length);
  const revealRef = useRef(revealLength);
  revealRef.current = revealLength;

  // Track the previous target so we can detect replacement vs. append.
  const prevTargetRef = useRef(target);

  useEffect(() => {
    const prevTarget = prevTargetRef.current;
    prevTargetRef.current = target;

    // Replacement (not an extension of what we were revealing) or reduced
    // motion: show everything immediately.
    if (!target.startsWith(prevTarget) || prefersReducedMotion()) {
      setRevealLength(target.length);
      return;
    }

    if (revealRef.current >= target.length) {
      setRevealLength(target.length);
      return;
    }

    let frame = 0;
    let lastTime: number | null = null;

    const tick = (now: number) => {
      const elapsed = lastTime === null ? 0 : now - lastTime;
      lastTime = now;
      const next = nextRevealLength(
        revealRef.current,
        target.length,
        elapsed,
        charsPerSecond,
      );
      revealRef.current = next;
      setRevealLength(next);
      if (next < target.length) {
        frame = requestAnimationFrame(tick);
      }
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, charsPerSecond]);

  return target.slice(0, revealLength);
}
