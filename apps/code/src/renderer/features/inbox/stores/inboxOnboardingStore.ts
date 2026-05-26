import { create } from "zustand";
import { persist } from "zustand/middleware";

interface InboxOnboardingState {
  /** Latched once the inline InboxSetupPane has rendered at least once. */
  hasSeenOnboarding: boolean;
  /**
   * Latched once the user has opened the Configure sources dialog — auto or
   * manually. Permanently suppresses the "All of your Inbox configuration is
   * here" tooltip on the toolbar.
   */
  hasDismissedConfigTooltip: boolean;
  markOnboardingSeen: () => void;
  dismissConfigTooltip: () => void;
}

export const useInboxOnboardingStore = create<InboxOnboardingState>()(
  persist(
    (set) => ({
      hasSeenOnboarding: false,
      hasDismissedConfigTooltip: false,
      markOnboardingSeen: () => set({ hasSeenOnboarding: true }),
      dismissConfigTooltip: () => set({ hasDismissedConfigTooltip: true }),
    }),
    { name: "inbox-onboarding-storage" },
  ),
);
