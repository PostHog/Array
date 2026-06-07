import { useTRPC } from "@renderer/trpc";
import { useMutation } from "@tanstack/react-query";
import { useSubscription } from "@trpc/tanstack-react-query";
import { useMemo, useState } from "react";

export interface ZoomState {
  level: number;
  percent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
}

const DEFAULT_ZOOM_STATE: ZoomState = {
  level: 0,
  percent: 100,
  canZoomIn: true,
  canZoomOut: true,
};

/** Thin wrappers over the zoom mutations. No subscription, so it's cheap to use
 * from global keyboard handlers. */
export function useZoomActions() {
  const trpc = useTRPC();
  const zoomIn = useMutation(trpc.zoom.zoomIn.mutationOptions());
  const zoomOut = useMutation(trpc.zoom.zoomOut.mutationOptions());
  const reset = useMutation(trpc.zoom.reset.mutationOptions());

  return useMemo(
    () => ({
      zoomIn: () => zoomIn.mutate(),
      zoomOut: () => zoomOut.mutate(),
      reset: () => reset.mutate(),
    }),
    [zoomIn.mutate, zoomOut.mutate, reset.mutate],
  );
}

/** Current zoom state, kept in sync via the main-process subscription (which
 * emits the current value on connect). */
export function useZoomState(): ZoomState {
  const trpc = useTRPC();
  const [state, setState] = useState<ZoomState>(DEFAULT_ZOOM_STATE);

  useSubscription(
    trpc.zoom.onChange.subscriptionOptions(undefined, {
      onData: (data) => setState(data),
    }),
  );

  return state;
}
