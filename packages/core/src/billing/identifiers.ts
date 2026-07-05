import type { SeatData } from "@posthog/shared";

export interface SubscriptionEventProps {
  plan_key: string;
  previous_plan_key?: string;
}

export interface SeatClient {
  getMySeat(options?: { best?: boolean }): Promise<SeatData | null>;
  createSeat(planKey: string): Promise<SeatData>;
  upgradeSeat(planKey: string): Promise<SeatData>;
  cancelSeat(): Promise<void>;
  reactivateSeat(): Promise<SeatData>;
  invalidatePlanCache(): void;
  trackSubscriptionStarted(props: SubscriptionEventProps): void;
  trackSubscriptionCancelled(props: SubscriptionEventProps): void;
}

export interface SeatLogger {
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
}

export const SEAT_CLIENT = Symbol.for("posthog.core.seatClient");
export const SEAT_SERVICE = Symbol.for("posthog.core.seatService");
