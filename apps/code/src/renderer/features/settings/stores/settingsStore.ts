import type { WorkspaceMode } from "@main/services/workspace/schemas";
import type { ExecutionMode } from "@shared/types";
import { electronStorage } from "@utils/electronStorage";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type DefaultRunMode = "local" | "cloud" | "last_used";
export type LocalWorkspaceMode = "worktree" | "local";
export type SendMessagesWith = "enter" | "cmd+enter";
export type CompletionSound =
  | "none"
  | "guitar"
  | "danilo"
  | "revi"
  | "meep"
  | "bubbles"
  | "drop"
  | "knock"
  | "ring"
  | "shoot"
  | "slide"
  | "switch"
  | "wilhelm";
export type AgentAdapter = "claude" | "codex";
export type AutoConvertLongText = "off" | "1000" | "2500" | "5000" | "10000";
export type DefaultInitialTaskMode = "plan" | "last_used";

export interface HintState {
  count: number;
  learned: boolean;
}
export type DiffOpenMode = "auto" | "split" | "same-pane" | "last-active-pane";

interface SettingsStore {
  defaultRunMode: DefaultRunMode;
  lastUsedRunMode: "local" | "cloud";
  lastUsedLocalWorkspaceMode: LocalWorkspaceMode;
  lastUsedWorkspaceMode: WorkspaceMode;
  lastUsedAdapter: AgentAdapter;
  lastUsedModel: string | null;
  lastUsedReasoningEffort: string | null;
  lastUsedCloudRepository: string | null;
  lastUsedEnvironments: Record<string, string>;
  desktopNotifications: boolean;
  dockBadgeNotifications: boolean;
  dockBounceNotifications: boolean;

  autoConvertLongText: AutoConvertLongText;
  completionSound: CompletionSound;
  completionVolume: number;
  sendMessagesWith: SendMessagesWith;
  allowBypassPermissions: boolean;
  preventSleepWhileRunning: boolean;
  debugLogsCloudRuns: boolean;
  customInstructions: string;
  defaultInitialTaskMode: DefaultInitialTaskMode;
  lastUsedInitialTaskMode: ExecutionMode;
  diffOpenMode: DiffOpenMode;
  hedgehogMode: boolean;
  mcpAppsDisabledServers: string[];
  hints: Record<string, HintState>;

  shouldShowHint: (key: string, max?: number) => boolean;
  recordHintShown: (key: string) => void;
  markHintLearned: (key: string) => void;

  setCompletionSound: (sound: CompletionSound) => void;
  setCompletionVolume: (volume: number) => void;
  setDefaultRunMode: (mode: DefaultRunMode) => void;
  setLastUsedRunMode: (mode: "local" | "cloud") => void;
  setLastUsedLocalWorkspaceMode: (mode: LocalWorkspaceMode) => void;
  setLastUsedWorkspaceMode: (mode: WorkspaceMode) => void;
  setLastUsedAdapter: (adapter: AgentAdapter) => void;
  setLastUsedModel: (model: string) => void;
  setLastUsedReasoningEffort: (effort: string) => void;
  setLastUsedCloudRepository: (repo: string | null) => void;
  setLastUsedEnvironment: (
    repoPath: string,
    environmentId: string | null,
  ) => void;
  getLastUsedEnvironment: (repoPath: string) => string | null;
  setDesktopNotifications: (enabled: boolean) => void;
  setDockBadgeNotifications: (enabled: boolean) => void;
  setDockBounceNotifications: (enabled: boolean) => void;

  setAutoConvertLongText: (value: AutoConvertLongText) => void;
  setSendMessagesWith: (mode: SendMessagesWith) => void;
  setAllowBypassPermissions: (enabled: boolean) => void;
  setPreventSleepWhileRunning: (enabled: boolean) => void;
  setDebugLogsCloudRuns: (enabled: boolean) => void;
  setCustomInstructions: (instructions: string) => void;
  setDefaultInitialTaskMode: (mode: DefaultInitialTaskMode) => void;
  setLastUsedInitialTaskMode: (mode: ExecutionMode) => void;
  setDiffOpenMode: (mode: DiffOpenMode) => void;
  setHedgehogMode: (enabled: boolean) => void;
  setMcpAppsDisabledServers: (servers: string[]) => void;
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set, get) => ({
      defaultRunMode: "last_used",
      lastUsedRunMode: "local",
      lastUsedLocalWorkspaceMode: "local",
      lastUsedWorkspaceMode: "local",
      lastUsedAdapter: "claude",
      lastUsedModel: null,
      lastUsedReasoningEffort: null,
      lastUsedCloudRepository: null,
      lastUsedEnvironments: {},
      desktopNotifications: true,
      dockBadgeNotifications: true,
      dockBounceNotifications: false,
      completionSound: "none",
      completionVolume: 80,

      autoConvertLongText: "2500",
      sendMessagesWith: "enter",
      allowBypassPermissions: false,
      preventSleepWhileRunning: false,
      debugLogsCloudRuns: false,
      customInstructions: "",
      defaultInitialTaskMode: "plan",
      lastUsedInitialTaskMode: "plan",
      diffOpenMode: "auto",
      hedgehogMode: false,
      mcpAppsDisabledServers: [],
      hints: {},

      shouldShowHint: (key, max = 3) => {
        const hint = get().hints[key];
        if (!hint) return true;
        return !hint.learned && hint.count < max;
      },
      recordHintShown: (key) =>
        set((state) => {
          const current = state.hints[key] ?? { count: 0, learned: false };
          return {
            hints: {
              ...state.hints,
              [key]: { ...current, count: current.count + 1 },
            },
          };
        }),
      markHintLearned: (key) =>
        set((state) => {
          const current = state.hints[key] ?? { count: 0, learned: false };
          return {
            hints: {
              ...state.hints,
              [key]: { ...current, learned: true },
            },
          };
        }),

      setCompletionSound: (sound) => set({ completionSound: sound }),
      setCompletionVolume: (volume) => set({ completionVolume: volume }),
      setDefaultRunMode: (mode) => set({ defaultRunMode: mode }),
      setLastUsedRunMode: (mode) => set({ lastUsedRunMode: mode }),
      setLastUsedLocalWorkspaceMode: (mode) =>
        set({ lastUsedLocalWorkspaceMode: mode }),
      setLastUsedWorkspaceMode: (mode) => set({ lastUsedWorkspaceMode: mode }),
      setLastUsedAdapter: (adapter) => set({ lastUsedAdapter: adapter }),
      setLastUsedModel: (model) => set({ lastUsedModel: model }),
      setLastUsedReasoningEffort: (effort) =>
        set({ lastUsedReasoningEffort: effort }),
      setLastUsedCloudRepository: (repo) =>
        set({ lastUsedCloudRepository: repo }),
      setLastUsedEnvironment: (repoPath, environmentId) =>
        set((state) => {
          const next = { ...state.lastUsedEnvironments };
          if (environmentId) {
            next[repoPath] = environmentId;
          } else {
            delete next[repoPath];
          }
          return { lastUsedEnvironments: next };
        }),
      getLastUsedEnvironment: (repoPath) =>
        get().lastUsedEnvironments[repoPath] ?? null,
      setDesktopNotifications: (enabled) =>
        set({ desktopNotifications: enabled }),
      setDockBadgeNotifications: (enabled) =>
        set({ dockBadgeNotifications: enabled }),
      setDockBounceNotifications: (enabled) =>
        set({ dockBounceNotifications: enabled }),

      setAutoConvertLongText: (value) => set({ autoConvertLongText: value }),
      setSendMessagesWith: (mode) => set({ sendMessagesWith: mode }),
      setAllowBypassPermissions: (enabled) =>
        set({ allowBypassPermissions: enabled }),
      setPreventSleepWhileRunning: (enabled) =>
        set({ preventSleepWhileRunning: enabled }),
      setDebugLogsCloudRuns: (enabled) => set({ debugLogsCloudRuns: enabled }),
      setCustomInstructions: (instructions) =>
        set({ customInstructions: instructions }),
      setDefaultInitialTaskMode: (mode) =>
        set({ defaultInitialTaskMode: mode }),
      setLastUsedInitialTaskMode: (mode) =>
        set({ lastUsedInitialTaskMode: mode }),
      setDiffOpenMode: (mode) => set({ diffOpenMode: mode }),
      setHedgehogMode: (enabled) => set({ hedgehogMode: enabled }),
      setMcpAppsDisabledServers: (servers) =>
        set({ mcpAppsDisabledServers: servers }),
    }),
    {
      name: "settings-storage",
      storage: electronStorage,
      partialize: (state) => ({
        defaultRunMode: state.defaultRunMode,
        lastUsedRunMode: state.lastUsedRunMode,
        lastUsedLocalWorkspaceMode: state.lastUsedLocalWorkspaceMode,
        lastUsedWorkspaceMode: state.lastUsedWorkspaceMode,
        lastUsedAdapter: state.lastUsedAdapter,
        lastUsedModel: state.lastUsedModel,
        lastUsedReasoningEffort: state.lastUsedReasoningEffort,
        lastUsedCloudRepository: state.lastUsedCloudRepository,
        lastUsedEnvironments: state.lastUsedEnvironments,
        desktopNotifications: state.desktopNotifications,
        dockBadgeNotifications: state.dockBadgeNotifications,
        dockBounceNotifications: state.dockBounceNotifications,

        autoConvertLongText: state.autoConvertLongText,
        completionSound: state.completionSound,
        completionVolume: state.completionVolume,
        sendMessagesWith: state.sendMessagesWith,
        allowBypassPermissions: state.allowBypassPermissions,
        preventSleepWhileRunning: state.preventSleepWhileRunning,
        debugLogsCloudRuns: state.debugLogsCloudRuns,
        customInstructions: state.customInstructions,
        defaultInitialTaskMode: state.defaultInitialTaskMode,
        lastUsedInitialTaskMode: state.lastUsedInitialTaskMode,
        diffOpenMode: state.diffOpenMode,
        hedgehogMode: state.hedgehogMode,
        hints: state.hints,
        mcpAppsDisabledServers: state.mcpAppsDisabledServers,
      }),
      merge: (persisted, current) => {
        const merged = {
          ...current,
          ...(persisted as Partial<SettingsStore>),
        };
        if (typeof merged.autoConvertLongText === "boolean") {
          (merged as Record<string, unknown>).autoConvertLongText =
            merged.autoConvertLongText ? "1000" : "off";
        }
        if ((merged.autoConvertLongText as string) === "500") {
          (merged as Record<string, unknown>).autoConvertLongText = "1000";
        }
        return merged;
      },
    },
  ),
);
