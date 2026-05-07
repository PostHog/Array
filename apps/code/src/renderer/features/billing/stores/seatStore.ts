import { getAuthenticatedClient } from "@features/auth/hooks/authClient";
import {
  SeatPaymentFailedError,
  SeatSubscriptionRequiredError,
} from "@renderer/api/posthogClient";
import { trpcClient } from "@renderer/trpc";
import type { SeatData } from "@shared/types/seat";
import { PLAN_FREE, PLAN_PRO } from "@shared/types/seat";
import { logger } from "@utils/logger";
import { queryClient } from "@utils/queryClient";
import { create } from "zustand";

const log = logger.scope("seat-store");

interface SeatStoreState {
  seat: SeatData | null;
  orgSeat: SeatData | null;
  isLoading: boolean;
  error: string | null;
  redirectUrl: string | null;
  billingOrgId: string | null;
}

interface SeatStoreActions {
  fetchSeat: (options?: { autoProvision?: boolean }) => Promise<void>;
  provisionFreeSeat: () => Promise<void>;
  upgradeToPro: () => Promise<void>;
  cancelSeat: () => Promise<void>;
  reactivateSeat: () => Promise<void>;
  clearError: () => void;
  reset: () => void;
}

type SeatStore = SeatStoreState & SeatStoreActions;

async function getClient() {
  const client = await getAuthenticatedClient();
  if (!client) {
    throw new Error("Not authenticated");
  }
  return client;
}

async function fetchAndProvision(
  client: Awaited<ReturnType<typeof getClient>>,
  options: { best: boolean; autoProvision: boolean },
): Promise<SeatData | null> {
  let seat = await client.getMySeat({ best: options.best });
  if (!seat && options.autoProvision) {
    log.info("No seat found, auto-provisioning free plan", {
      best: options.best,
    });
    try {
      seat = await client.createSeat(PLAN_FREE);
    } catch {
      log.info("Auto-provision failed, re-fetching seat");
      seat = await client.getMySeat({ best: options.best });
    }
  }
  return seat;
}

function handleSeatError(
  error: unknown,
  set: (state: Partial<SeatStoreState>) => void,
): void {
  if (!(error instanceof Error)) {
    log.error("Seat operation failed", error);
    set({ isLoading: false, error: "An unexpected error occurred" });
    return;
  }

  if (error instanceof SeatSubscriptionRequiredError) {
    set({
      isLoading: false,
      error: "Billing subscription required",
      redirectUrl: error.redirectUrl,
    });
    return;
  }

  if (error instanceof SeatPaymentFailedError) {
    set({ isLoading: false, error: error.message });
    return;
  }

  log.error("Seat operation failed", error);
  set({ isLoading: false, error: error.message });
}

function invalidatePlanCache(): void {
  trpcClient.llmGateway.invalidatePlanCache.mutate().catch((err) => {
    log.warn("Failed to invalidate plan cache", err);
  });
  void queryClient.invalidateQueries({ queryKey: [["llmGateway"]] });
}

const initialState: SeatStoreState = {
  seat: null,
  orgSeat: null,
  isLoading: false,
  error: null,
  redirectUrl: null,
  billingOrgId: null,
};

export const useSeatStore = create<SeatStore>()((set, get) => ({
  ...initialState,

  fetchSeat: async (options?: { autoProvision?: boolean }) => {
    set({ isLoading: true, error: null, redirectUrl: null });
    try {
      const client = await getClient();
      const autoProvision = options?.autoProvision ?? false;
      const [seat, orgSeat] = await Promise.all([
        fetchAndProvision(client, { best: true, autoProvision }),
        fetchAndProvision(client, { best: false, autoProvision }),
      ]);
      set({
        seat,
        orgSeat,
        isLoading: false,
        billingOrgId: seat?.organization_id ?? null,
      });
    } catch (error) {
      const { seat: existingSeat } = get();
      if (existingSeat) {
        log.warn("fetchSeat failed but seat already loaded, keeping it", error);
        set({ isLoading: false });
        return;
      }
      handleSeatError(error, set);
    }
  },

  provisionFreeSeat: async () => {
    log.info("Provisioning free seat");
    set({ isLoading: true, error: null, redirectUrl: null });
    try {
      const client = await getClient();
      const existing = await client.getMySeat();
      if (existing) {
        log.info("Seat already exists on server", {
          plan: existing.plan_key,
          status: existing.status,
        });
        set({
          seat: existing,
          isLoading: false,
          billingOrgId: existing.organization_id ?? null,
        });
        return;
      }
      const seat = await client.createSeat(PLAN_FREE);
      log.info("Free seat created", { id: seat.id, plan: seat.plan_key });
      set({
        seat,
        isLoading: false,
        billingOrgId: seat.organization_id ?? null,
      });
      invalidatePlanCache();
    } catch (error) {
      log.error("provisionFreeSeat failed", error);
      handleSeatError(error, set);
    }
  },

  upgradeToPro: async () => {
    set({ isLoading: true, error: null, redirectUrl: null });
    try {
      const client = await getClient();
      const existing = await client.getMySeat();
      if (existing) {
        if (existing.plan_key === PLAN_PRO) {
          set({
            seat: existing,
            isLoading: false,
            billingOrgId: existing.organization_id ?? null,
          });
          return;
        }
        const seat = await client.upgradeSeat(PLAN_PRO);
        set({
          seat,
          orgSeat: seat,
          isLoading: false,
          billingOrgId: seat.organization_id ?? null,
        });
        invalidatePlanCache();
        return;
      }
      const seat = await client.createSeat(PLAN_PRO);
      set({
        seat,
        orgSeat: seat,
        isLoading: false,
        billingOrgId: seat.organization_id ?? null,
      });
      invalidatePlanCache();
    } catch (error) {
      handleSeatError(error, set);
    }
  },

  cancelSeat: async () => {
    set({ isLoading: true, error: null, redirectUrl: null });
    try {
      const client = await getClient();
      await client.cancelSeat();
      const seat = await client.getMySeat();
      set({
        seat,
        orgSeat: seat,
        isLoading: false,
        billingOrgId: seat?.organization_id ?? null,
      });
      invalidatePlanCache();
    } catch (error) {
      handleSeatError(error, set);
    }
  },

  reactivateSeat: async () => {
    set({ isLoading: true, error: null, redirectUrl: null });
    try {
      const client = await getClient();
      const seat = await client.reactivateSeat();
      set({
        seat,
        orgSeat: seat,
        isLoading: false,
        billingOrgId: seat.organization_id ?? null,
      });
      invalidatePlanCache();
    } catch (error) {
      handleSeatError(error, set);
    }
  },

  clearError: () => set({ error: null, redirectUrl: null }),

  reset: () => set(initialState),
}));
