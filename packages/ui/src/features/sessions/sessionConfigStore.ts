import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import type { AlwaysOnSkillRef } from "@posthog/shared";
import { electronStorage } from "@posthog/ui/shell/rendererStorage";
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SessionConfigState {
  configsByRunId: Record<string, SessionConfigOption[]>;
  alwaysOnSkillsByRunId: Record<string, AlwaysOnSkillRef[]>;
}

interface SessionConfigActions {
  /** Save config options for a task run */
  setConfigOptions: (taskRunId: string, options: SessionConfigOption[]) => void;
  /** Get config options for a task run */
  getConfigOptions: (taskRunId: string) => SessionConfigOption[] | undefined;
  /** Remove config options for a task run */
  removeConfigOptions: (taskRunId: string) => void;
  setAlwaysOnSkills: (taskRunId: string, skills: AlwaysOnSkillRef[]) => void;
  getAlwaysOnSkills: (taskRunId: string) => AlwaysOnSkillRef[] | undefined;
  removeAlwaysOnSkills: (taskRunId: string) => void;
}

type SessionConfigStore = SessionConfigState & SessionConfigActions;

export const useSessionConfigStore = create<SessionConfigStore>()(
  persist(
    (set, get) => ({
      configsByRunId: {},
      alwaysOnSkillsByRunId: {},

      setConfigOptions: (taskRunId, options) =>
        set((state) => ({
          configsByRunId: { ...state.configsByRunId, [taskRunId]: options },
        })),

      getConfigOptions: (taskRunId) => get().configsByRunId[taskRunId],

      removeConfigOptions: (taskRunId) =>
        set((state) => {
          const { [taskRunId]: _removed, ...rest } = state.configsByRunId;
          return { configsByRunId: rest };
        }),
      setAlwaysOnSkills: (taskRunId, skills) =>
        set((state) => ({
          alwaysOnSkillsByRunId: {
            ...state.alwaysOnSkillsByRunId,
            [taskRunId]: skills,
          },
        })),
      getAlwaysOnSkills: (taskRunId) => get().alwaysOnSkillsByRunId[taskRunId],
      removeAlwaysOnSkills: (taskRunId) =>
        set((state) => {
          const { [taskRunId]: _removed, ...rest } =
            state.alwaysOnSkillsByRunId;
          return { alwaysOnSkillsByRunId: rest };
        }),
    }),
    {
      name: "session-config-storage",
      storage: electronStorage,
      partialize: (state) => ({
        configsByRunId: state.configsByRunId,
        alwaysOnSkillsByRunId: state.alwaysOnSkillsByRunId,
      }),
    },
  ),
);

/** Non-hook accessor for getting persisted config options */
export function getPersistedConfigOptions(
  taskRunId: string,
): SessionConfigOption[] | undefined {
  return useSessionConfigStore.getState().getConfigOptions(taskRunId);
}

/** Non-hook accessor for setting persisted config options */
export function setPersistedConfigOptions(
  taskRunId: string,
  options: SessionConfigOption[],
): void {
  useSessionConfigStore.getState().setConfigOptions(taskRunId, options);
}

/** Non-hook accessor for removing persisted config options */
export function removePersistedConfigOptions(taskRunId: string): void {
  useSessionConfigStore.getState().removeConfigOptions(taskRunId);
}

export function getPersistedAlwaysOnSkills(
  taskRunId: string,
): AlwaysOnSkillRef[] | undefined {
  return useSessionConfigStore.getState().getAlwaysOnSkills(taskRunId);
}

export function setPersistedAlwaysOnSkills(
  taskRunId: string,
  skills: AlwaysOnSkillRef[],
): void {
  useSessionConfigStore.getState().setAlwaysOnSkills(taskRunId, skills);
}

export function removePersistedAlwaysOnSkills(taskRunId: string): void {
  useSessionConfigStore.getState().removeAlwaysOnSkills(taskRunId);
}
