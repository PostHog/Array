import { useService } from "@posthog/di/react";
import { type RefObject, useEffect, useRef, useState } from "react";
import { useMeQuery } from "../features/auth/useMeQuery";
import { useSettingsStore } from "../features/settings/settingsStore";
import { captureException } from "./analytics";
import {
  HEDGEHOG_MODE_HOST,
  type HedgehogModeHandle,
  type HedgehogModeHost,
} from "./hedgehogModeHost";
import { logger } from "./logger";

const log = logger.scope("hedgehog-mode");
const MAX_CONTEXT_LOSS_REMOUNTS = 3;
const REMOUNT_DELAY_MS = 2000;
const CONTEXT_CHECK_INTERVAL_MS = 10_000;

function destroyGame(
  handleRef: RefObject<HedgehogModeHandle | null>,
  container: HTMLDivElement | null,
) {
  try {
    handleRef.current?.destroy();
  } catch (err) {
    log.error("Failed to destroy hedgehog mode game", err);
  }
  handleRef.current = null;
  container?.replaceChildren();
}

export function HedgehogMode() {
  const hedgehogMode = useSettingsStore((s) => s.hedgehogMode);
  const setHedgehogMode = useSettingsStore((s) => s.setHedgehogMode);
  const { data: user } = useMeQuery();
  const host = useService<HedgehogModeHost>(HEDGEHOG_MODE_HOST);
  const containerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HedgehogModeHandle | null>(null);
  const [gameDead, setGameDead] = useState(false);

  useEffect(() => {
    if (hedgehogMode) return;
    setGameDead(false);
  }, [hedgehogMode]);

  useEffect(() => {
    if (!hedgehogMode || gameDead || !containerRef.current || !host) return;

    let cancelled = false;
    let lost = false;
    let losses = 0;
    let canvas: HTMLCanvasElement | null = null;
    let remountTimer: ReturnType<typeof setTimeout> | null = null;
    const container = containerRef.current;

    const hedgehogConfig = user?.hedgehog_config as Record<
      string,
      unknown
    > | null;
    const actorOptions = hedgehogConfig?.actor_options;

    // A game whose WebGL context died composites its full-window canvas as an
    // opaque sheet over the whole app, so it must leave the DOM immediately.
    const handleContextLost = () => {
      if (lost) return;
      lost = true;
      losses += 1;
      log.error("Hedgehog mode WebGL context lost", { losses });
      captureException(new Error("Hedgehog mode WebGL context lost"), {
        source: "hedgehog-mode",
        losses,
      });
      destroyGame(handleRef, container);
      if (losses > MAX_CONTEXT_LOSS_REMOUNTS) {
        setGameDead(true);
        return;
      }
      remountTimer = setTimeout(mountGame, REMOUNT_DELAY_MS);
    };

    const isCanvasContextLost = () => {
      if (!canvas) return false;
      const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
      return gl?.isContextLost() ?? false;
    };

    // Backup for a missed webglcontextlost event (e.g. swallowed across
    // sleep/wake), so a dead canvas can never linger on screen undetected.
    const checkContext = () => {
      if (!lost && isCanvasContextLost()) {
        handleContextLost();
      }
    };

    const mountGame = () => {
      if (cancelled || handleRef.current) return;
      if (losses > 0) {
        log.warn("Remounting hedgehog mode after WebGL context loss", {
          attempt: losses,
        });
      }
      host
        .mount(container, {
          actorOptions,
          onQuit: () => setHedgehogMode(false),
        })
        .then((handle) => {
          if (cancelled) {
            handle.destroy();
            return;
          }
          handleRef.current = handle;
          lost = false;
          canvas = container.querySelector("canvas");
          canvas?.addEventListener("webglcontextlost", handleContextLost, {
            once: true,
          });
        })
        .catch((err) => {
          log.error("Failed to mount hedgehog mode", err);
        });
    };

    mountGame();
    const contextCheckInterval = setInterval(
      checkContext,
      CONTEXT_CHECK_INTERVAL_MS,
    );
    window.addEventListener("focus", checkContext);
    document.addEventListener("visibilitychange", checkContext);

    return () => {
      cancelled = true;
      clearInterval(contextCheckInterval);
      window.removeEventListener("focus", checkContext);
      document.removeEventListener("visibilitychange", checkContext);
      if (remountTimer) {
        clearTimeout(remountTimer);
      }
      canvas?.removeEventListener("webglcontextlost", handleContextLost);
      destroyGame(handleRef, container);
    };
  }, [hedgehogMode, gameDead, user?.hedgehog_config, setHedgehogMode, host]);

  return (
    <div
      ref={containerRef}
      style={{
        zIndex: 999998,
        visibility: hedgehogMode && !gameDead ? "visible" : "hidden",
      }}
      className="pointer-events-none fixed inset-0"
    />
  );
}
