import { electronStorage } from "@utils/electronStorage";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type HomeDemoScenario = "off" | "populated" | "empty";

interface HomeDemoStore {
  scenario: HomeDemoScenario;
  setScenario: (scenario: HomeDemoScenario) => void;
}

export const useHomeDemoStore = create<HomeDemoStore>()(
  persist(
    (set) => ({
      scenario: "off",
      setScenario: (scenario) => set({ scenario }),
    }),
    {
      name: "home-demo-store",
      storage: electronStorage,
    },
  ),
);
