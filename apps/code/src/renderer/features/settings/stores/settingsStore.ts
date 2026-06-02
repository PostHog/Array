import type { WorkspaceMode } from "@main/services/workspace/schemas";
import type { ExecutionMode } from "@shared/types";
import { electronStorage } from "@utils/electronStorage";
import { create } from "zustand";
import { persist } from "zustand/middleware";

// ---------- Types ----------

export type DefaultRunMode = "local" | "cloud" | "last_used";
export type LocalWorkspaceMode = "worktree" | "local";
export type AgentAdapter = "claude" | "codex";
export type DefaultInitialTaskMode = "plan" | "last_used";
export type DefaultReasoningEffort =
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max"
  | "last_used";

export type SendMessagesWith = "enter" | "cmd+enter";
export type AutoConvertLongText = "off" | "1000" | "2500" | "5000" | "10000";
export type DiffOpenMode = "auto" | "split" | "same-pane" | "last-active-pane";

export type CompletionSound =
  | "none"
  | "guitar"
  | "danilo"
  | "revi"
  | "meep"
  | "meep-smol"
  | "bubbles"
  | "drop"
  | "knock"
  | "ring"
  | "shoot"
  | "slide"
  | "switch"
  | "wilhelm";

export type TerminalFont =
  | "berkeley-mono"
  | "jetbrains-mono"
  | "system"
  | "custom";

export interface HintState {
  count: number;
  learned: boolean;
}

// ---------- Store shape ----------

interface SettingsStore {
  // Run mode + last-used flow defaults
  defaultRunMode: DefaultRunMode;
  lastUsedRunMode: "local" | "cloud";
  lastUsedLocalWorkspaceMode: LocalWorkspaceMode;
  lastUsedWorkspaceMode: WorkspaceMode;
  lastUsedAdapter: AgentAdapter;
  lastUsedModel: string | null;
  lastUsedReasoningEffort: string | null;
  lastUsedCloudRepository: string | null;
  lastUsedEnvironments: Record<string, string>;
  defaultInitialTaskMode: DefaultInitialTaskMode;
  lastUsedInitialTaskMode: ExecutionMode;
  defaultReasoningEffort: DefaultReasoningEffort;
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
  setDefaultInitialTaskMode: (mode: DefaultInitialTaskMode) => void;
  setLastUsedInitialTaskMode: (mode: ExecutionMode) => void;
  setDefaultReasoningEffort: (effort: DefaultReasoningEffort) => void;

  // Notifications
  desktopNotifications: boolean;
  dockBadgeNotifications: boolean;
  dockBounceNotifications: boolean;
  completionSound: CompletionSound;
  completionVolume: number;
  setDesktopNotifications: (enabled: boolean) => void;
  setDockBadgeNotifications: (enabled: boolean) => void;
  setDockBounceNotifications: (enabled: boolean) => void;
  setCompletionSound: (sound: CompletionSound) => void;
  setCompletionVolume: (volume: number) => void;

  // Composer / chat
  autoConvertLongText: AutoConvertLongText;
  sendMessagesWith: SendMessagesWith;
  customInstructions: string;
  setAutoConvertLongText: (value: AutoConvertLongText) => void;
  setSendMessagesWith: (mode: SendMessagesWith) => void;
  setCustomInstructions: (instructions: string) => void;

  // Diff viewer
  diffOpenMode: DiffOpenMode;
  setDiffOpenMode: (mode: DiffOpenMode) => void;

  // System / power / permissions
  allowBypassPermissions: boolean;
  preventSleepWhileRunning: boolean;
  debugLogsCloudRuns: boolean;
  setAllowBypassPermissions: (enabled: boolean) => void;
  setPreventSleepWhileRunning: (enabled: boolean) => void;
  setDebugLogsCloudRuns: (enabled: boolean) => void;

  // Terminal
  terminalFont: TerminalFont;
  terminalCustomFontFamily: string;
  setTerminalFont: (font: TerminalFont) => void;
  setTerminalCustomFontFamily: (value: string) => void;

  // Experimental / misc
  hedgehogMode: boolean;
  mcpAppsDisabledServers: string[];
  setHedgehogMode: (enabled: boolean) => void;
  setMcpAppsDisabledServers: (servers: string[]) => void;

  // Onboarding hints
  hints: Record<string, HintState>;
  shouldShowHint: (key: string, max?: number) => boolean;
  recordHintShown: (key: string) => void;
  markHintLearned: (key: string) => void;
}

// ---------- Store ----------

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set, get) => ({
      // Run mode + last-used flow defaults
      defaultRunMode: "last_used",
      lastUsedRunMode: "local",
      lastUsedLocalWorkspaceMode: "local",
      lastUsedWorkspaceMode: "local",
      lastUsedAdapter: "claude",
      lastUsedModel: null,
      lastUsedReasoningEffort: null,
      lastUsedCloudRepository: null,
      lastUsedEnvironments: {},
      defaultInitialTaskMode: "plan",
      lastUsedInitialTaskMode: "plan",
      defaultReasoningEffort: "last_used",
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
      setDefaultInitialTaskMode: (mode) =>
        set({ defaultInitialTaskMode: mode }),
      setLastUsedInitialTaskMode: (mode) =>
        set({ lastUsedInitialTaskMode: mode }),
      setDefaultReasoningEffort: (effort) =>
        set({ defaultReasoningEffort: effort }),

      // Notifications
      desktopNotifications: true,
      dockBadgeNotifications: true,
      dockBounceNotifications: false,
      completionSound: "none",
      completionVolume: 80,
      setDesktopNotifications: (enabled) =>
        set({ desktopNotifications: enabled }),
      setDockBadgeNotifications: (enabled) =>
        set({ dockBadgeNotifications: enabled }),
      setDockBounceNotifications: (enabled) =>
        set({ dockBounceNotifications: enabled }),
      setCompletionSound: (sound) => set({ completionSound: sound }),
      setCompletionVolume: (volume) => set({ completionVolume: volume }),

      // Composer / chat
      autoConvertLongText: "2500",
      sendMessagesWith: "enter",
      customInstructions: "",
      setAutoConvertLongText: (value) => set({ autoConvertLongText: value }),
      setSendMessagesWith: (mode) => set({ sendMessagesWith: mode }),
      setCustomInstructions: (instructions) =>
        set({ customInstructions: instructions }),

      // Diff viewer
      diffOpenMode: "auto",
      setDiffOpenMode: (mode) => set({ diffOpenMode: mode }),

      // System / power / permissions
      allowBypassPermissions: false,
      preventSleepWhileRunning: false,
      debugLogsCloudRuns: false,
      setAllowBypassPermissions: (enabled) =>
        set({ allowBypassPermissions: enabled }),
      setPreventSleepWhileRunning: (enabled) =>
        set({ preventSleepWhileRunning: enabled }),
      setDebugLogsCloudRuns: (enabled) => set({ debugLogsCloudRuns: enabled }),

      // Terminal
      terminalFont: "berkeley-mono",
      terminalCustomFontFamily: "",
      setTerminalFont: (font) => set({ terminalFont: font }),
      setTerminalCustomFontFamily: (value) =>
        set({ terminalCustomFontFamily: value }),

      // Experimental / misc
      hedgehogMode: false,
      mcpAppsDisabledServers: [],
      setHedgehogMode: (enabled) => set({ hedgehogMode: enabled }),
      setMcpAppsDisabledServers: (servers) =>
        set({ mcpAppsDisabledServers: servers }),

      // Onboarding hints
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
    }),
    {
      name: "settings-storage",
      storage: electronStorage,
      partialize: (state) => ({
        // Run mode + last-used flow defaults
        defaultRunMode: state.defaultRunMode,
        lastUsedRunMode: state.lastUsedRunMode,
        lastUsedLocalWorkspaceMode: state.lastUsedLocalWorkspaceMode,
        lastUsedWorkspaceMode: state.lastUsedWorkspaceMode,
        lastUsedAdapter: state.lastUsedAdapter,
        lastUsedModel: state.lastUsedModel,
        lastUsedReasoningEffort: state.lastUsedReasoningEffort,
        lastUsedCloudRepository: state.lastUsedCloudRepository,
        lastUsedEnvironments: state.lastUsedEnvironments,
        defaultInitialTaskMode: state.defaultInitialTaskMode,
        lastUsedInitialTaskMode: state.lastUsedInitialTaskMode,
        defaultReasoningEffort: state.defaultReasoningEffort,

        // Notifications
        desktopNotifications: state.desktopNotifications,
        dockBadgeNotifications: state.dockBadgeNotifications,
        dockBounceNotifications: state.dockBounceNotifications,
        completionSound: state.completionSound,
        completionVolume: state.completionVolume,

        // Composer / chat
        autoConvertLongText: state.autoConvertLongText,
        sendMessagesWith: state.sendMessagesWith,
        customInstructions: state.customInstructions,

        // Diff viewer
        diffOpenMode: state.diffOpenMode,

        // System / power / permissions
        allowBypassPermissions: state.allowBypassPermissions,
        preventSleepWhileRunning: state.preventSleepWhileRunning,
        debugLogsCloudRuns: state.debugLogsCloudRuns,

        // Terminal
        terminalFont: state.terminalFont,
        terminalCustomFontFamily: state.terminalCustomFontFamily,

        // Experimental / misc
        hedgehogMode: state.hedgehogMode,
        mcpAppsDisabledServers: state.mcpAppsDisabledServers,

        // Onboarding hints
        hints: state.hints,
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
