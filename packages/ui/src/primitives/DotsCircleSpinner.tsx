import { useSyncExternalStore } from "react";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const INTERVAL = 80;

let globalFrameIndex = 0;
let subscriberCount = 0;
let globalTimer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function subscribe(callback: () => void) {
  listeners.add(callback);
  subscriberCount++;
  if (subscriberCount === 1) {
    globalTimer = setInterval(() => {
      globalFrameIndex = (globalFrameIndex + 1) % FRAMES.length;
      for (const listener of listeners) {
        listener();
      }
    }, INTERVAL);
  }
  return () => {
    listeners.delete(callback);
    subscriberCount--;
    if (subscriberCount === 0 && globalTimer) {
      clearInterval(globalTimer);
      globalTimer = null;
    }
  };
}

function getSnapshot() {
  return globalFrameIndex;
}

interface DotsCircleSpinnerProps {
  size?: number;
  className?: string;
}

export function DotsCircleSpinner({
  size = 12,
  className,
}: DotsCircleSpinnerProps) {
  const frameIndex = useSyncExternalStore(subscribe, getSnapshot);

  return (
    <span
      className={`inline-flex items-center justify-center ${className}`}
      style={{
        width: size,
        height: size,
        fontSize: size,
        lineHeight: 1,
      }}
    >
      {FRAMES[frameIndex]}
    </span>
  );
}
