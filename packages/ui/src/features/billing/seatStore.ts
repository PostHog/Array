import { SEAT_SERVICE } from "@posthog/core/billing/identifiers";
import type {
  SeatOperationResult,
  SeatService,
} from "@posthog/core/billing/seatService";
import { resolveService } from "@posthog/di/container";
import type { SeatData } from "@posthog/shared";
import { create } from "zustand";

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

const initialState: SeatStoreState = {
  seat: null,
  orgSeat: null,
  isLoading: false,
  error: null,
  redirectUrl: null,
  billingOrgId: null,
};

function applyResult(
  set: (state: Partial<SeatStoreState>) => void,
  result: SeatOperationResult,
): void {
  if (result.keepExisting) {
    set({ isLoading: false });
    return;
  }
  set({
    seat: result.seat,
    billingOrgId: result.billingOrgId,
    error: result.error,
    redirectUrl: result.redirectUrl,
    isLoading: false,
    ...(result.orgSeatUnchanged ? {} : { orgSeat: result.orgSeat }),
  });
}

export const useSeatStore = create<SeatStore>()((set, get) => ({
  ...initialState,

  fetchSeat: async (options?: { autoProvision?: boolean }) => {
    set({ isLoading: true, error: null, redirectUrl: null });
    const service = resolveService<SeatService>(SEAT_SERVICE);
    const result = await service.fetchSeat({
      autoProvision: options?.autoProvision,
      currentSeat: get().seat,
    });
    applyResult(set, result);
  },

  provisionFreeSeat: async () => {
    set({ isLoading: true, error: null, redirectUrl: null });
    const result =
      await resolveService<SeatService>(SEAT_SERVICE).provisionFreeSeat();
    applyResult(set, result);
  },

  upgradeToPro: async () => {
    set({ isLoading: true, error: null, redirectUrl: null });
    const result =
      await resolveService<SeatService>(SEAT_SERVICE).upgradeToPro();
    applyResult(set, result);
  },

  cancelSeat: async () => {
    set({ isLoading: true, error: null, redirectUrl: null });
    const result = await resolveService<SeatService>(SEAT_SERVICE).cancelSeat(
      get().seat?.plan_key,
    );
    applyResult(set, result);
  },

  reactivateSeat: async () => {
    set({ isLoading: true, error: null, redirectUrl: null });
    const result =
      await resolveService<SeatService>(SEAT_SERVICE).reactivateSeat();
    applyResult(set, result);
  },

  clearError: () => set({ error: null, redirectUrl: null }),

  reset: () => set(initialState),
}));
