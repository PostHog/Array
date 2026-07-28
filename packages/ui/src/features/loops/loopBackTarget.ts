import { useLocation } from "@tanstack/react-router";

export interface LoopBackTarget {
  channelId: string;
}

declare module "@tanstack/react-router" {
  interface HistoryState {
    loopBackTarget?: LoopBackTarget;
  }
}

export function asLoopBackTarget(value: unknown): LoopBackTarget | null {
  if (!value || typeof value !== "object") return null;
  const { channelId } = value as Record<string, unknown>;
  if (typeof channelId !== "string" || channelId.length === 0) return null;
  return { channelId };
}

export function useLoopBackTarget(): LoopBackTarget | null {
  const target = useLocation({
    select: (location) => location.state.loopBackTarget,
  });
  return asLoopBackTarget(target);
}
