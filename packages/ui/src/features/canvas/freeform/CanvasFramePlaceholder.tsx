import type {
  CanvasAnalyticsConfig,
  CanvasNavIntent,
} from "@posthog/core/canvas/freeformSchemas";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useCanvasRefreshNonce } from "../stores/canvasRefreshStore";
import { useCanvasFrameStore } from "./canvasFrameStore";

// Stands in for the canvas inside the route tree. It renders nothing visible —
// just an empty box that reserves the canvas viewport — and hands the actual
// rendering to the persistent warm-frame pool (CanvasFrameHost): it registers this
// canvas's inputs, activates it on mount (deactivates on unmount, keeping the frame
// warm), and reports its on-screen rect so the host can overlay the warm iframe.
export function CanvasFramePlaceholder({
  dashboardId,
  code,
  analytics,
  onDataRequest,
  onError,
  onRendered,
  onNavigate,
}: {
  dashboardId: string;
  code: string;
  analytics?: CanvasAnalyticsConfig;
  onDataRequest: (method: string, payload: unknown) => Promise<unknown>;
  onError?: (message: string, stack?: string) => void;
  onRendered?: () => void;
  onNavigate?: (intent: CanvasNavIntent) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const refreshKey = useCanvasRefreshNonce(`dashboard:${dashboardId}`);

  const register = useCanvasFrameStore((s) => s.register);
  const setRect = useCanvasFrameStore((s) => s.setRect);
  const activate = useCanvasFrameStore((s) => s.activate);
  const deactivate = useCanvasFrameStore((s) => s.deactivate);

  const inputs = useMemo(
    () => ({
      code,
      analytics,
      refreshKey,
      onDataRequest,
      onError,
      onRendered,
      onNavigate,
    }),
    [
      code,
      analytics,
      refreshKey,
      onDataRequest,
      onError,
      onRendered,
      onNavigate,
    ],
  );

  useEffect(() => {
    register(dashboardId, inputs);
  }, [dashboardId, inputs, register]);

  useLayoutEffect(() => {
    activate(dashboardId);
    return () => deactivate(dashboardId);
  }, [dashboardId, activate, deactivate]);

  // Track the placeholder's viewport box. A capture-phase scroll listener catches
  // ancestor scrolling (not just this element), so the overlaid frame stays glued.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setRect(dashboardId, {
        top: r.top,
        left: r.left,
        width: r.width,
        height: r.height,
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [dashboardId, setRect]);

  return <div ref={ref} className="h-full w-full" />;
}
