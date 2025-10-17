import type { AgentEvent } from "@posthog/agent";
import type {
  ClarifyingQuestion,
  ExecutionMode,
  PlanModePhase,
  QuestionAnswer,
  Task,
} from "@shared/types";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useAuthStore } from "./authStore";

type AgentTaskProgress = {
  has_progress?: boolean;
  status?: "started" | "in_progress" | "completed" | "failed";
  current_step?: string | null;
  completed_steps?: number | null;
  total_steps?: number | null;
  progress_percentage?: number | null;
  message?: string | null;
  output_log?: string | null;
};

const createProgressSignature = (progress: AgentTaskProgress): string =>
  [
    progress.status ?? "",
    progress.current_step ?? "",
    progress.completed_steps ?? "",
    progress.total_steps ?? "",
    progress.progress_percentage ?? "",
    progress.message ?? "",
    progress.output_log ?? "",
  ].join("|");

const formatProgressLog = (progress: AgentTaskProgress): string => {
  const statusLabel = progress.status?.replace(/_/g, " ") ?? "in progress";
  const currentStep =
    typeof progress.completed_steps === "number"
      ? progress.completed_steps + 1
      : 1;
  const total =
    typeof progress.total_steps === "number" && progress.total_steps >= 0
      ? progress.total_steps
      : "?";
  const step =
    typeof progress.current_step === "string" &&
    progress.current_step.length > 0
      ? progress.current_step
      : "-";
  const percentage =
    typeof progress.total_steps === "number" && progress.total_steps > 0
      ? ` ${Math.round((currentStep / progress.total_steps) * 100)}%`
      : "";
  return `Progress: ${statusLabel} | step=${step} (${currentStep}/${total})${percentage}`;
};

interface TaskExecutionState {
  isRunning: boolean;
  logs: AgentEvent[];
  repoPath: string | null;
  currentTaskId: string | null;
  runMode: "local" | "cloud";
  unsubscribe: (() => void) | null;
  progress: AgentTaskProgress | null;
  progressSignature: string | null;
  // Plan mode fields
  executionMode: ExecutionMode;
  planModePhase: PlanModePhase;
  clarifyingQuestions: ClarifyingQuestion[];
  questionAnswers: QuestionAnswer[];
  planContent: string | null;
  selectedArtifact: string | null; // Currently viewing artifact filename
}

interface TaskExecutionStore {
  // State per task ID
  taskStates: Record<string, TaskExecutionState>;
  // Repository (org/repo) to working directory mapping
  repoToCwd: Record<string, string>;

  // Basic state accessors
  getTaskState: (taskId: string) => TaskExecutionState;
  updateTaskState: (
    taskId: string,
    updates: Partial<TaskExecutionState>,
  ) => void;
  setRunning: (taskId: string, isRunning: boolean) => void;
  addLog: (taskId: string, log: AgentEvent) => void;
  setLogs: (taskId: string, logs: AgentEvent[]) => void;
  setRepoPath: (taskId: string, repoPath: string | null) => void;
  setCurrentTaskId: (taskId: string, currentTaskId: string | null) => void;
  setRunMode: (taskId: string, runMode: "local" | "cloud") => void;
  setUnsubscribe: (taskId: string, unsubscribe: (() => void) | null) => void;
  setProgress: (taskId: string, progress: AgentTaskProgress | null) => void;
  clearTaskState: (taskId: string) => void;

  // Repository to working directory mapping
  getRepoWorkingDir: (repoKey: string) => string | null;
  setRepoWorkingDir: (repoKey: string, path: string) => void;

  // High-level task execution actions
  selectRepositoryForTask: (taskId: string, repoKey?: string) => Promise<void>;
  runTask: (taskId: string, task: Task) => Promise<void>;
  cancelTask: (taskId: string) => Promise<void>;
  clearTaskLogs: (taskId: string) => void;

  // Event subscription management
  subscribeToAgentEvents: (taskId: string, channel: string) => void;
  unsubscribeFromAgentEvents: (taskId: string) => void;

  // Plan mode actions
  setExecutionMode: (taskId: string, mode: ExecutionMode) => void;
  setPlanModePhase: (taskId: string, phase: PlanModePhase) => void;
  setClarifyingQuestions: (
    taskId: string,
    questions: ClarifyingQuestion[],
  ) => void;
  setQuestionAnswers: (taskId: string, answers: QuestionAnswer[]) => void;
  addQuestionAnswer: (taskId: string, answer: QuestionAnswer) => void;
  setPlanContent: (taskId: string, content: string | null) => void;
  setSelectedArtifact: (taskId: string, fileName: string | null) => void;
  runPlanMode: (taskId: string, task: Task) => Promise<void>;
  generatePlan: (taskId: string, task: Task) => Promise<void>;
}

const defaultTaskState: TaskExecutionState = {
  isRunning: false,
  logs: [],
  repoPath: null,
  currentTaskId: null,
  runMode: "local",
  unsubscribe: null,
  progress: null,
  progressSignature: null,
  executionMode: "workflow",
  planModePhase: "idle",
  clarifyingQuestions: [],
  questionAnswers: [],
  planContent: null,
  selectedArtifact: null,
};

export const useTaskExecutionStore = create<TaskExecutionStore>()(
  persist(
    (set, get) => ({
      taskStates: {},
      repoToCwd: {},

      getTaskState: (taskId: string) => {
        const state = get();
        return state.taskStates[taskId] || { ...defaultTaskState };
      },

      getRepoWorkingDir: (repoKey: string) => {
        return get().repoToCwd[repoKey] || null;
      },

      setRepoWorkingDir: (repoKey: string, path: string) => {
        set((state) => ({
          repoToCwd: {
            ...state.repoToCwd,
            [repoKey]: path,
          },
        }));
      },

      updateTaskState: (
        taskId: string,
        updates: Partial<TaskExecutionState>,
      ) => {
        set((state) => ({
          taskStates: {
            ...state.taskStates,
            [taskId]: {
              ...(state.taskStates[taskId] || defaultTaskState),
              ...updates,
            },
          },
        }));
      },

      setRunning: (taskId: string, isRunning: boolean) => {
        get().updateTaskState(taskId, { isRunning });
      },

      addLog: (taskId: string, log: AgentEvent) => {
        const currentState = get().getTaskState(taskId);
        get().updateTaskState(taskId, {
          logs: [...currentState.logs, log],
        });
      },

      setLogs: (taskId: string, logs: AgentEvent[]) => {
        get().updateTaskState(taskId, { logs });
      },

      setRepoPath: (taskId: string, repoPath: string | null) => {
        get().updateTaskState(taskId, { repoPath });
      },

      setCurrentTaskId: (taskId: string, currentTaskId: string | null) => {
        get().updateTaskState(taskId, { currentTaskId });
      },

      setRunMode: (taskId: string, runMode: "local" | "cloud") => {
        get().updateTaskState(taskId, { runMode });
      },

      setUnsubscribe: (taskId: string, unsubscribe: (() => void) | null) => {
        get().updateTaskState(taskId, { unsubscribe });
      },

      setProgress: (taskId: string, progress: AgentTaskProgress | null) => {
        get().updateTaskState(taskId, {
          progress,
          progressSignature: progress
            ? createProgressSignature(progress)
            : null,
        });
      },

      clearTaskState: (taskId: string) => {
        const state = get();
        const taskState = state.taskStates[taskId];
        if (taskState?.unsubscribe) {
          taskState.unsubscribe();
        }
        set((state) => {
          const newTaskStates = { ...state.taskStates };
          delete newTaskStates[taskId];
          return { taskStates: newTaskStates };
        });
      },

      subscribeToAgentEvents: (taskId: string, channel: string) => {
        const store = get();

        // Clean up existing subscription if any
        const existingState = store.taskStates[taskId];
        if (existingState?.unsubscribe) {
          existingState.unsubscribe();
        }

        // Create new subscription that persists even when component unmounts
        const unsubscribeFn = window.electronAPI?.onAgentEvent(
          channel,
          (
            ev: AgentEvent | { type: "progress"; progress: AgentTaskProgress },
          ) => {
            const currentStore = get();

            // Handle custom progress events from Array backend
            if (ev?.type === "progress" && "progress" in ev) {
              const newProgress = ev.progress;
              const oldProgress = currentStore.getTaskState(taskId).progress;
              const oldSig = oldProgress
                ? createProgressSignature(oldProgress)
                : null;
              const newSig = createProgressSignature(newProgress);
              if (oldSig !== newSig) {
                const progressLog = formatProgressLog(newProgress);
                currentStore.setProgress(taskId, newProgress);
                currentStore.addLog(taskId, {
                  type: "status",
                  ts: Date.now(),
                  phase: progressLog,
                });
              }
              return;
            }

            // Store AgentEvent directly (ev is now narrowed to AgentEvent)
            if (ev?.type) {
              // Handle state changes for special event types
              if (ev.type === "error" || ev.type === "done") {
                currentStore.setRunning(taskId, false);
                if (ev.type === "done") {
                  currentStore.setUnsubscribe(taskId, null);
                }
              }

              // Add event to logs
              currentStore.addLog(taskId, ev);
            }
          },
        );

        // Store the unsubscribe function
        store.setUnsubscribe(taskId, unsubscribeFn);
      },

      unsubscribeFromAgentEvents: (taskId: string) => {
        const state = get();
        const taskState = state.taskStates[taskId];
        if (taskState?.unsubscribe) {
          taskState.unsubscribe();
          get().setUnsubscribe(taskId, null);
        }
      },

      // High-level task execution actions
      selectRepositoryForTask: async (taskId: string, repoKey?: string) => {
        const store = get();
        try {
          const selected = await window.electronAPI?.selectDirectory();
          if (selected) {
            const isRepo = await window.electronAPI?.validateRepo(selected);
            if (!isRepo) {
              store.addLog(taskId, {
                type: "error",
                ts: Date.now(),
                message: `Selected folder is not a git repository: ${selected}`,
              });
              return;
            }
            const canWrite =
              await window.electronAPI?.checkWriteAccess(selected);
            if (!canWrite) {
              store.addLog(taskId, {
                type: "error",
                ts: Date.now(),
                message: `No write permission in selected folder: ${selected}`,
              });
              const result = await window.electronAPI?.showMessageBox({
                type: "warning",
                title: "Folder is not writable",
                message: "The selected folder is not writable by the app.",
                detail:
                  "Grant access by selecting a different folder or adjusting permissions.",
                buttons: ["Grant Access", "Cancel"],
                defaultId: 0,
                cancelId: 1,
              });
              if (!result) return;
              const { response } = result;
              if (response === 0) {
                // Let user reselect and validate again
                return store.selectRepositoryForTask(taskId, repoKey);
              }
              return;
            }
            store.setRepoPath(taskId, selected);
            // Save mapping for future tasks with the same repository
            if (repoKey) {
              store.setRepoWorkingDir(repoKey, selected);
            }
          }
        } catch (err) {
          store.addLog(taskId, {
            type: "error",
            ts: Date.now(),
            message: `Error selecting directory: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      },

      runTask: async (taskId: string, task: Task) => {
        const store = get();
        const taskState = store.getTaskState(taskId);

        if (taskState.isRunning) return;

        if (!task.workflow) {
          store.addLog(taskId, {
            type: "error",
            ts: Date.now(),
            message: "Select a PostHog workflow before running the agent.",
          });
          return;
        }

        const { apiKey, apiHost } = useAuthStore.getState();
        if (!apiKey) {
          store.addLog(taskId, {
            type: "error",
            ts: Date.now(),
            message:
              "No PostHog API key found. Sign in to PostHog to run workflows.",
          });
          return;
        }

        // Ensure repo path is selected
        let effectiveRepoPath = taskState.repoPath;
        if (!effectiveRepoPath) {
          await store.selectRepositoryForTask(taskId);
          effectiveRepoPath = store.getTaskState(taskId).repoPath;
        }

        if (!effectiveRepoPath) {
          store.addLog(taskId, {
            type: "error",
            ts: Date.now(),
            message: "No repository folder selected.",
          });
          return;
        }

        const isRepo =
          await window.electronAPI?.validateRepo(effectiveRepoPath);
        if (!isRepo) {
          store.addLog(taskId, {
            type: "error",
            ts: Date.now(),
            message: `Selected folder is not a git repository: ${effectiveRepoPath}`,
          });
          return;
        }

        const canWrite =
          await window.electronAPI?.checkWriteAccess(effectiveRepoPath);
        if (!canWrite) {
          store.addLog(taskId, {
            type: "error",
            ts: Date.now(),
            message: `No write permission in selected folder: ${effectiveRepoPath}`,
          });
          const result = await window.electronAPI?.showMessageBox({
            type: "warning",
            title: "Folder is not writable",
            message: "This folder is not writable by the app.",
            detail:
              "Grant access by selecting a different folder or adjusting permissions.",
            buttons: ["Grant Access", "Cancel"],
            defaultId: 0,
            cancelId: 1,
          });
          if (!result) return;
          const { response } = result;
          if (response === 0) {
            await store.selectRepositoryForTask(taskId);
          }
          return;
        }

        const currentTaskState = store.getTaskState(taskId);
        const permissionMode =
          currentTaskState.runMode === "cloud" ? "default" : "acceptEdits";

        store.setProgress(taskId, null);
        store.setRunning(taskId, true);
        const startTs = Date.now();
        store.setLogs(taskId, [
          {
            type: "token",
            ts: startTs,
            content: `Starting workflow run...`,
          },
          {
            type: "token",
            ts: startTs,
            content: `Permission mode: ${permissionMode}`,
          },
          {
            type: "token",
            ts: startTs,
            content: `Repo: ${effectiveRepoPath}`,
          },
        ]);

        try {
          const result = await window.electronAPI?.agentStart({
            taskId: task.id,
            workflowId: task.workflow,
            repoPath: effectiveRepoPath,
            apiKey,
            apiHost,
            permissionMode,
            autoProgress: true,
          });
          if (!result) {
            store.addLog(taskId, {
              type: "error",
              ts: Date.now(),
              message: "Failed to start agent: electronAPI not available",
            });
            store.setRunning(taskId, false);
            return;
          }
          const { taskId: executionTaskId, channel } = result;

          store.setCurrentTaskId(taskId, executionTaskId);

          // Subscribe to streaming events using store-managed subscription
          store.subscribeToAgentEvents(taskId, channel);
        } catch (error) {
          store.addLog(taskId, {
            type: "error",
            ts: Date.now(),
            message: `Error starting agent: ${error instanceof Error ? error.message : "Unknown error"}`,
          });
          store.setRunning(taskId, false);
        }
      },

      cancelTask: async (taskId: string) => {
        const store = get();
        const taskState = store.getTaskState(taskId);

        if (!taskState.currentTaskId) return;

        try {
          await window.electronAPI?.agentCancel(taskState.currentTaskId);
        } catch {
          // Ignore cancellation errors
        }

        store.addLog(taskId, {
          type: "token",
          ts: Date.now(),
          content: "Run cancelled",
        });

        store.setRunning(taskId, false);
        store.unsubscribeFromAgentEvents(taskId);
      },

      clearTaskLogs: (taskId: string) => {
        get().setLogs(taskId, []);
      },

      // Plan mode actions
      setExecutionMode: (taskId: string, mode: ExecutionMode) => {
        get().updateTaskState(taskId, { executionMode: mode });
      },

      setPlanModePhase: (taskId: string, phase: PlanModePhase) => {
        get().updateTaskState(taskId, { planModePhase: phase });
      },

      setClarifyingQuestions: (
        taskId: string,
        questions: ClarifyingQuestion[],
      ) => {
        get().updateTaskState(taskId, { clarifyingQuestions: questions });
      },

      setQuestionAnswers: (taskId: string, answers: QuestionAnswer[]) => {
        get().updateTaskState(taskId, { questionAnswers: answers });
      },

      addQuestionAnswer: (taskId: string, answer: QuestionAnswer) => {
        const currentState = get().getTaskState(taskId);
        const existingIndex = currentState.questionAnswers.findIndex(
          (a) => a.questionId === answer.questionId,
        );
        const updatedAnswers =
          existingIndex >= 0
            ? currentState.questionAnswers.map((a, i) =>
                i === existingIndex ? answer : a,
              )
            : [...currentState.questionAnswers, answer];
        get().updateTaskState(taskId, { questionAnswers: updatedAnswers });
      },

      setPlanContent: (taskId: string, content: string | null) => {
        get().updateTaskState(taskId, { planContent: content });
      },

      setSelectedArtifact: (taskId: string, fileName: string | null) => {
        get().updateTaskState(taskId, { selectedArtifact: fileName });
      },

      runPlanMode: async (taskId: string, task: Task) => {
        const store = get();
        const taskState = store.getTaskState(taskId);

        if (taskState.isRunning) return;

        const { apiKey, apiHost } = useAuthStore.getState();
        if (!apiKey) {
          store.addLog(taskId, {
            type: "error",
            ts: Date.now(),
            message:
              "No PostHog API key found. Sign in to PostHog to run plan mode.",
          });
          return;
        }

        // Ensure repo path is selected
        let effectiveRepoPath = taskState.repoPath;
        if (!effectiveRepoPath) {
          await store.selectRepositoryForTask(taskId);
          effectiveRepoPath = store.getTaskState(taskId).repoPath;
        }

        if (!effectiveRepoPath) {
          store.addLog(taskId, {
            type: "error",
            ts: Date.now(),
            message: "No repository folder selected.",
          });
          return;
        }

        const isRepo =
          await window.electronAPI?.validateRepo(effectiveRepoPath);
        if (!isRepo) {
          store.addLog(taskId, {
            type: "error",
            ts: Date.now(),
            message: `Selected folder is not a git repository: ${effectiveRepoPath}`,
          });
          return;
        }

        // Clear previous plan mode state
        store.setPlanModePhase(taskId, "research");
        store.setClarifyingQuestions(taskId, []);
        store.setQuestionAnswers(taskId, []);
        store.setProgress(taskId, null);
        store.setRunning(taskId, true);

        const startTs = Date.now();
        store.setLogs(taskId, [
          {
            type: "token",
            ts: startTs,
            content: "Starting plan mode research phase...",
          },
          {
            type: "token",
            ts: startTs,
            content: `Repo: ${effectiveRepoPath}`,
          },
        ]);

        try {
          const result = await window.electronAPI?.agentStartPlanMode({
            taskId: task.id,
            taskTitle: task.title,
            taskDescription: task.description,
            repoPath: effectiveRepoPath,
            apiKey,
            apiHost,
          });

          if (!result) {
            store.addLog(taskId, {
              type: "error",
              ts: Date.now(),
              message: "Failed to start plan mode: electronAPI not available",
            });
            store.setRunning(taskId, false);
            store.setPlanModePhase(taskId, "idle");
            return;
          }

          const { taskId: executionTaskId, channel } = result;
          store.setCurrentTaskId(taskId, executionTaskId);

          // Subscribe to streaming events
          store.subscribeToAgentEvents(taskId, channel);
        } catch (error) {
          store.addLog(taskId, {
            type: "error",
            ts: Date.now(),
            message: `Error starting plan mode: ${error instanceof Error ? error.message : "Unknown error"}`,
          });
          store.setRunning(taskId, false);
          store.setPlanModePhase(taskId, "idle");
        }
      },

      generatePlan: async (taskId: string, task: Task) => {
        const store = get();
        const taskState = store.getTaskState(taskId);

        if (taskState.isRunning) return;

        const { apiKey, apiHost } = useAuthStore.getState();
        if (!apiKey) {
          store.addLog(taskId, {
            type: "error",
            ts: Date.now(),
            message:
              "No PostHog API key found. Sign in to PostHog to generate plan.",
          });
          return;
        }

        const effectiveRepoPath = taskState.repoPath;
        if (!effectiveRepoPath) {
          store.addLog(taskId, {
            type: "error",
            ts: Date.now(),
            message: "No repository folder selected.",
          });
          return;
        }

        store.setPlanModePhase(taskId, "planning");
        store.setRunning(taskId, true);

        const startTs = Date.now();
        store.addLog(taskId, {
          type: "token",
          ts: startTs,
          content: "Generating implementation plan...",
        });

        try {
          const result = await window.electronAPI?.agentGeneratePlan({
            taskId: task.id,
            taskTitle: task.title,
            taskDescription: task.description,
            repoPath: effectiveRepoPath,
            questionAnswers: taskState.questionAnswers,
            apiKey,
            apiHost,
          });

          if (!result) {
            store.addLog(taskId, {
              type: "error",
              ts: Date.now(),
              message: "Failed to generate plan: electronAPI not available",
            });
            store.setRunning(taskId, false);
            store.setPlanModePhase(taskId, "questions");
            return;
          }

          const { taskId: executionTaskId, channel } = result;
          store.setCurrentTaskId(taskId, executionTaskId);

          // Subscribe to streaming events
          store.subscribeToAgentEvents(taskId, channel);
        } catch (error) {
          store.addLog(taskId, {
            type: "error",
            ts: Date.now(),
            message: `Error generating plan: ${error instanceof Error ? error.message : "Unknown error"}`,
          });
          store.setRunning(taskId, false);
          store.setPlanModePhase(taskId, "questions");
        }
      },
    }),
    {
      name: "task-execution-storage",
      // Don't persist unsubscribe functions as they can't be serialized
      partialize: (state) => ({
        taskStates: Object.fromEntries(
          Object.entries(state.taskStates).map(([taskId, taskState]) => [
            taskId,
            { ...taskState, unsubscribe: null },
          ]),
        ),
      }),
    },
  ),
);
