import { useService } from "@posthog/di/react";
import { useEffect, useRef } from "react";
import { useMeQuery } from "../features/auth/useMeQuery";
import { useSettingsStore } from "../features/settings/settingsStore";
import {
  HEDGEHOG_MODE_HOST,
  type HedgehogModeHandle,
  type HedgehogModeHost,
} from "./hedgehogModeHost";
import { logger } from "./logger";

const log = logger.scope("hedgehog-mode");

export function HedgehogMode() {
  const hedgehogMode = useSettingsStore((s) => s.hedgehogMode);
  const setHedgehogMode = useSettingsStore((s) => s.setHedgehogMode);
  const { data: user } = useMeQuery();
  const host = useService<HedgehogModeHost>(HEDGEHOG_MODE_HOST);
  const containerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HedgehogModeHandle | null>(null);

  useEffect(() => {
    if (!hedgehogMode || !containerRef.current || handleRef.current) return;
    if (!host) return;

    let cancelled = false;
    const container = containerRef.current;

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
      })
      .catch((err) => {
        log.error("Failed to mount hedgehog mode", err);
      });

    return () => {
      cancelled = true;
    };
  }, [hedgehogMode, user?.hedgehog_config, setHedgehogMode, host]);

  useEffect(() => {
    return () => {
      if (handleRef.current) {
        handleRef.current.destroy();
        handleRef.current = null;
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        zIndex: 999998,
        visibility: hedgehogMode ? "visible" : "hidden",
      }}
      className="pointer-events-none fixed inset-0"
    />
  );
}
