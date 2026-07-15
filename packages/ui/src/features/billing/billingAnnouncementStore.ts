import { create } from "zustand";

const STORAGE_KEY = "posthog-code-usage-billing-acknowledged";

function readAcknowledged(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

interface BillingAnnouncementState {
  acknowledged: boolean;
}

interface BillingAnnouncementActions {
  acknowledge: () => void;
}

type BillingAnnouncementStore = BillingAnnouncementState &
  BillingAnnouncementActions;

export const useBillingAnnouncementStore = create<BillingAnnouncementStore>()(
  (set) => ({
    acknowledged: readAcknowledged(),
    acknowledge: () => {
      try {
        window.localStorage.setItem(STORAGE_KEY, "true");
      } catch {
        // Persistence failing only means the announcement shows again next
        // launch; the acknowledgment event still records on the person.
      }
      set({ acknowledged: true });
    },
  }),
);
