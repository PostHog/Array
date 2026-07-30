import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import { electronStorage } from "@posthog/ui/shell/rendererStorage";
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SessionConfigState {
  configsByRunId: Record<string, SessionConfigOption[]>;
  alwaysOnSkillInstructionsByRunId: Record<string, string>;
}

interface SessionConfigActions {
  /** Save config options for a task run */
  setConfigOptions: (taskRunId: string, options: SessionConfigOption[]) => void;
  /** Get config options for a task run */
  getConfigOptions: (taskRunId: string) => SessionConfigOption[] | undefined;
  /** Remove config options for a task run */
  removeConfigOptions: (taskRunId: string) => void;
  setAlwaysOnSkillInstructions: (
    taskRunId: string,
    instructions: string,
  ) => void;
  getAlwaysOnSkillInstructions: (taskRunId: string) => string | undefined;
  removeAlwaysOnSkillInstructions: (taskRunId: string) => void;
}

type SessionConfigStore = SessionConfigState & SessionConfigActions;

export const useSessionConfigStore = create<SessionConfigStore>()(
  persist(
    (set, get) => ({
      configsByRunId: {},
      alwaysOnSkillInstructionsByRunId: {},

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
      setAlwaysOnSkillInstructions: (taskRunId, instructions) =>
        set((state) => ({
          alwaysOnSkillInstructionsByRunId: {
            ...state.alwaysOnSkillInstructionsByRunId,
            [taskRunId]: instructions,
          },
        })),
      getAlwaysOnSkillInstructions: (taskRunId) =>
        get().alwaysOnSkillInstructionsByRunId[taskRunId],
      removeAlwaysOnSkillInstructions: (taskRunId) =>
        set((state) => {
          const { [taskRunId]: _removed, ...rest } =
            state.alwaysOnSkillInstructionsByRunId;
          return { alwaysOnSkillInstructionsByRunId: rest };
        }),
    }),
    {
      name: "session-config-storage",
      storage: electronStorage,
      partialize: (state) => ({
        configsByRunId: state.configsByRunId,
        alwaysOnSkillInstructionsByRunId:
          state.alwaysOnSkillInstructionsByRunId,
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

export function getPersistedAlwaysOnSkillInstructions(
  taskRunId: string,
): string | undefined {
  return useSessionConfigStore
    .getState()
    .getAlwaysOnSkillInstructions(taskRunId);
}

export function setPersistedAlwaysOnSkillInstructions(
  taskRunId: string,
  instructions: string,
): void {
  useSessionConfigStore
    .getState()
    .setAlwaysOnSkillInstructions(taskRunId, instructions);
}

export function removePersistedAlwaysOnSkillInstructions(
  taskRunId: string,
): void {
  useSessionConfigStore.getState().removeAlwaysOnSkillInstructions(taskRunId);
}
