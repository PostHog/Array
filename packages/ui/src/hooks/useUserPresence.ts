import { useEffect, useState } from "react";

/**
 * How long without any window input before the user counts as away.
 *
 * Tuned against the workspace-server agent idle timeout (15 min): once the
 * activity heartbeat stops, the server reclaims the idle agent process
 * (~300-400MB RSS per session) after its own timeout, so an away user frees
 * memory after presence-idle + server-idle. Reconnect on return is automatic
 * and takes seconds.
 */
export const USER_PRESENCE_IDLE_MS = 10 * 60 * 1000;

/** Presence bookkeeping is coarse; avoid work on every mousemove. */
const ACTIVITY_THROTTLE_MS = 15 * 1000;
const IDLE_CHECK_INTERVAL_MS = 60 * 1000;

const PRESENCE_EVENTS = [
  "pointerdown",
  "pointermove",
  "keydown",
  "wheel",
  "focus",
] as const;

/**
 * True while the user is actively using the app window; flips to false after
 * `idleMs` without any input, and back to true on the next interaction.
 */
export function useUserPresence(
  idleMs: number = USER_PRESENCE_IDLE_MS,
): boolean {
  const [present, setPresent] = useState(true);

  useEffect(() => {
    let lastActivityAt = Date.now();
    let lastRecordedAt = lastActivityAt;

    const onActivity = () => {
      const now = Date.now();
      if (now - lastRecordedAt < ACTIVITY_THROTTLE_MS) return;
      lastRecordedAt = now;
      lastActivityAt = now;
      setPresent(true);
    };

    for (const event of PRESENCE_EVENTS) {
      window.addEventListener(event, onActivity, { passive: true });
    }
    const idleCheck = setInterval(() => {
      if (Date.now() - lastActivityAt >= idleMs) {
        setPresent(false);
      }
    }, IDLE_CHECK_INTERVAL_MS);

    return () => {
      for (const event of PRESENCE_EVENTS) {
        window.removeEventListener(event, onActivity);
      }
      clearInterval(idleCheck);
    };
  }, [idleMs]);

  return present;
}
