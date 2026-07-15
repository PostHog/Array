import { ROOT_LOGGER, type RootLogger } from "@posthog/di/logger";
import { PLAN_FREE, PLAN_PRO, type SeatData } from "@posthog/shared";
import { inject, injectable } from "inversify";
import { SEAT_CLIENT, type SeatClient, type SeatLogger } from "./identifiers";
import { type ClassifiedSeatError, classifySeatError } from "./seatErrors";

export interface SeatOperationResult {
  seat: SeatData | null;
  orgSeat: SeatData | null;
  billingOrgId: string | null;
  error: string | null;
  redirectUrl: string | null;
  keepExisting?: boolean;
  orgSeatUnchanged?: boolean;
}

function ok(
  seat: SeatData | null,
  orgSeat: SeatData | null,
  orgSeatUnchanged = false,
): SeatOperationResult {
  return {
    seat,
    orgSeat,
    billingOrgId: seat?.organization_id ?? null,
    error: null,
    redirectUrl: null,
    orgSeatUnchanged,
  };
}

function fail(classified: ClassifiedSeatError): SeatOperationResult {
  return {
    seat: null,
    orgSeat: null,
    billingOrgId: null,
    error: classified.error,
    redirectUrl: classified.redirectUrl,
  };
}

@injectable()
export class SeatService {
  private readonly logger: SeatLogger;

  constructor(
    @inject(SEAT_CLIENT) private readonly client: SeatClient,
    @inject(ROOT_LOGGER) logger: RootLogger,
  ) {
    this.logger = logger.scope("seat-service");
  }

  private async fetchAndProvision(options: {
    best: boolean;
    autoProvision: boolean;
  }): Promise<SeatData | null> {
    let seat = await this.client.getMySeat({ best: options.best });
    if (!seat && options.autoProvision) {
      this.logger.info("No seat found, auto-provisioning free plan", {
        best: options.best,
      });
      try {
        seat = await this.client.createSeat(PLAN_FREE);
      } catch {
        this.logger.info("Auto-provision failed, re-fetching seat");
        seat = await this.client.getMySeat({ best: options.best });
      }
    }
    return seat;
  }

  async fetchSeat(options?: {
    autoProvision?: boolean;
    currentSeat?: SeatData | null;
  }): Promise<SeatOperationResult> {
    try {
      const autoProvision = options?.autoProvision ?? false;
      const [seat, orgSeat] = await Promise.all([
        this.fetchAndProvision({ best: true, autoProvision }),
        this.fetchAndProvision({ best: false, autoProvision }),
      ]);
      return ok(seat, orgSeat);
    } catch (error) {
      if (options?.currentSeat) {
        this.logger.warn(
          "fetchSeat failed but seat already loaded, keeping it",
          error,
        );
        return {
          seat: options.currentSeat,
          orgSeat: null,
          billingOrgId: options.currentSeat.organization_id ?? null,
          error: null,
          redirectUrl: null,
          keepExisting: true,
        };
      }
      return fail(classifySeatError(error));
    }
  }

  async provisionFreeSeat(): Promise<SeatOperationResult> {
    this.logger.info("Provisioning free seat");
    try {
      const existing = await this.client.getMySeat();
      if (existing) {
        this.logger.info("Seat already exists on server", {
          plan: existing.plan_key,
          status: existing.status,
        });
        return ok(existing, null, true);
      }
      const seat = await this.client.createSeat(PLAN_FREE);
      this.logger.info("Free seat created", {
        id: seat.id,
        plan: seat.plan_key,
      });
      this.client.invalidatePlanCache();
      return ok(seat, null, true);
    } catch (error) {
      this.logger.error("provisionFreeSeat failed", error);
      return fail(classifySeatError(error));
    }
  }

  async upgradeToPro(): Promise<SeatOperationResult> {
    try {
      const existing = await this.client.getMySeat();
      if (existing) {
        if (existing.plan_key === PLAN_PRO) {
          return ok(existing, null, true);
        }
        const seat = await this.client.upgradeSeat(PLAN_PRO);
        this.client.trackSubscriptionStarted({
          plan_key: seat.plan_key,
          previous_plan_key: existing.plan_key,
        });
        this.client.invalidatePlanCache();
        return ok(seat, seat);
      }
      const seat = await this.client.createSeat(PLAN_PRO);
      this.client.trackSubscriptionStarted({ plan_key: seat.plan_key });
      this.client.invalidatePlanCache();
      return ok(seat, seat);
    } catch (error) {
      return fail(classifySeatError(error));
    }
  }

  async cancelSeat(previousPlanKey?: string): Promise<SeatOperationResult> {
    try {
      await this.client.cancelSeat();
      const seat = await this.client.getMySeat();
      const cancelledPlanKey = previousPlanKey ?? seat?.plan_key;
      if (cancelledPlanKey) {
        this.client.trackSubscriptionCancelled({ plan_key: cancelledPlanKey });
      }
      this.client.invalidatePlanCache();
      return ok(seat, seat);
    } catch (error) {
      return fail(classifySeatError(error));
    }
  }

  async reactivateSeat(): Promise<SeatOperationResult> {
    try {
      const seat = await this.client.reactivateSeat();
      this.client.invalidatePlanCache();
      return ok(seat, seat);
    } catch (error) {
      return fail(classifySeatError(error));
    }
  }
}
