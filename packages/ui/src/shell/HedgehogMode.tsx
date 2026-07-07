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
  const contextLossesRef = useRef(0);
  const remountTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [remountAttempt, setRemountAttempt] = useState(0);
  const [gameDead, setGameDead] = useState(false);

  useEffect(() => {
    if (hedgehogMode) return;
    contextLossesRef.current = 0;
    setGameDead(false);
  }, [hedgehogMode]);

  useEffect(() => {
    if (!hedgehogMode || gameDead || !containerRef.current || handleRef.current)
      return;
    if (!host) return;

    let cancelled = false;
    let canvas: HTMLCanvasElement | null = null;
    const container = containerRef.current;

    // A game whose WebGL context died composites its full-window canvas as an
    // opaque sheet over the whole app, so it must leave the DOM immediately.
    const handleContextLost = () => {
      contextLossesRef.current += 1;
      const losses = contextLossesRef.current;
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
      remountTimerRef.current = setTimeout(() => {
        setRemountAttempt(losses);
      }, REMOUNT_DELAY_MS);
    };

    if (remountAttempt > 0) {
      log.warn("Remounting hedgehog mode after WebGL context loss", {
        attempt: remountAttempt,
      });
    }

    const hedgehogConfig = user?.hedgehog_config as Record<
      string,
      unknown
    > | null;
    const actorOptions = hedgehogConfig?.actor_options;

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
        canvas = container.querySelector("canvas");
        canvas?.addEventListener("webglcontextlost", handleContextLost, {
          once: true,
        });
      })
      .catch((err) => {
        log.error("Failed to mount hedgehog mode", err);
      });

    return () => {
      cancelled = true;
      canvas?.removeEventListener("webglcontextlost", handleContextLost);
    };
  }, [
    hedgehogMode,
    gameDead,
    remountAttempt,
    user?.hedgehog_config,
    setHedgehogMode,
    host,
  ]);

  useEffect(() => {
    return () => {
      if (remountTimerRef.current) {
        clearTimeout(remountTimerRef.current);
      }
      destroyGame(handleRef, containerRef.current);
    };
  }, []);

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
