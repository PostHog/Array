import type { Task } from "@shared/types";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { LogEntry } from "../types/log";
import { useAuthStore } from "./authStore";
import { useTaskStore } from "./taskStore";
import { useWorkflowStore } from "./workflowStore";

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
  const statusLabel =
    progress.status?.replace(/_/g, " ") ?? "in progress";
  const completed =
    typeof progress.completed_steps === "number"
      ? progress.completed_steps
      : 0;
  const total =
    typeof progress.total_steps === "number" && progress.total_steps >= 0
      ? progress.total_steps
      : "?";
  const step =
    typeof progress.current_step === "string" && progress.current_step.length > 0
      ? progress.current_step
      : "-";
  const percentage =
    typeof progress.progress_percentage === "number"
      ? ` ${Math.round(progress.progress_percentage)}%`
      : "";
  return `📊 Progress: ${statusLabel} | step=${step} (${completed}/${total})${percentage}`;
};

interface TaskExecutionState {
  isRunning: boolean;
  logs: Array<string | LogEntry>;
  repoPath: string | null;
  currentTaskId: string | null;
  runMode: "local" | "cloud";
  unsubscribe: (() => void) | null;
  progress: AgentTaskProgress | null;
  progressSignature: string | null;
}

interface TaskExecutionStore {
  // State per task ID
  taskStates: Record<string, TaskExecutionState>;

  // Basic state accessors
  getTaskState: (taskId: string) => TaskExecutionState;
  updateTaskState: (
    taskId: string,
    updates: Partial<TaskExecutionState>,
  ) => void;
  setRunning: (taskId: string, isRunning: boolean) => void;
  addLog: (taskId: string, log: string | LogEntry) => void;
  setLogs: (taskId: string, logs: Array<string | LogEntry>) => void;
  setRepoPath: (taskId: string, repoPath: string | null) => void;
  setCurrentTaskId: (taskId: string, currentTaskId: string | null) => void;
  setRunMode: (taskId: string, runMode: "local" | "cloud") => void;
  setUnsubscribe: (taskId: string, unsubscribe: (() => void) | null) => void;
  setProgress: (taskId: string, progress: AgentTaskProgress | null) => void;
  clearTaskState: (taskId: string) => void;

  // High-level task execution actions
  selectRepositoryForTask: (taskId: string) => Promise<void>;
  runTask: (taskId: string, task: Task) => Promise<void>;
  cancelTask: (taskId: string) => Promise<void>;
  clearTaskLogs: (taskId: string) => void;

  // Event subscription management
  subscribeToAgentEvents: (taskId: string, channel: string) => void;
  unsubscribeFromAgentEvents: (taskId: string) => void;
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
};

export const useTaskExecutionStore = create<TaskExecutionStore>()(
  persist(
    (set, get) => ({
      taskStates: {},

      getTaskState: (taskId: string) => {
        const state = get();
        return state.taskStates[taskId] || { ...defaultTaskState };
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

      addLog: (taskId: string, log: string | LogEntry) => {
        const currentState = get().getTaskState(taskId);
        get().updateTaskState(taskId, {
          logs: [...currentState.logs, log],
        });
      },

      setLogs: (taskId: string, logs: Array<string | LogEntry>) => {
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
          progressSignature: progress ? createProgressSignature(progress) : null,
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
          // biome-ignore lint/suspicious/noExplicitAny: I have no idea what the type is, but it's coming from the agent.
          (ev: any) => {
            const currentStore = get();

            switch (ev?.type) {
              case "token":
                if (
                  typeof ev.content === "string" &&
                  ev.content.trim().length > 0
                ) {
                  currentStore.addLog(taskId, {
                    type: "text",
                    ts: ev.ts || Date.now(),
                    content: ev.content,
                  });
                }
                break;
              case "progress": {
                const rawProgress = ev.progress as AgentTaskProgress | undefined;
                if (
                  rawProgress &&
                  typeof rawProgress === "object" &&
                  rawProgress.has_progress
                ) {
                  const previousState = currentStore.getTaskState(taskId);
                  const nextSignature = createProgressSignature(rawProgress);
                  if (previousState.progressSignature !== nextSignature) {
                    currentStore.setProgress(taskId, rawProgress);
                    currentStore.addLog(taskId, {
                      type: "text",
                      ts: ev.ts || Date.now(),
                      content: formatProgressLog(rawProgress),
                    });
                  }
                }
                break;
              }
              case "status":
                if (ev.phase) {
                  currentStore.addLog(taskId, {
                    type: "status",
                    ts: ev.ts || Date.now(),
                    phase: ev.phase,
                  });
                } else if (ev.message) {
                  currentStore.addLog(taskId, {
                    type: "text",
                    ts: ev.ts || Date.now(),
                    content: ev.message,
                  });
                }
                break;
              case "tool_call":
                currentStore.addLog(taskId, {
                  type: "tool_call",
                  ts: ev.ts || Date.now(),
                  toolName: ev.toolName || ev.tool || ev.name || "unknown-tool",
                  callId: ev.callId,
                  args: ev.args ?? ev.input,
                });
                break;
              case "tool_result":
                currentStore.addLog(taskId, {
                  type: "tool_result",
                  ts: ev.ts || Date.now(),
                  toolName: ev.toolName || ev.tool || ev.name || "unknown-tool",
                  callId: ev.callId,
                  result: ev.result ?? ev.output,
                });
                break;
              case "diff":
                currentStore.addLog(taskId, {
                  type: "diff",
                  ts: ev.ts || Date.now(),
                  file: ev.file || ev.path || "",
                  patch: ev.patch ?? ev.patchText ?? ev.diff,
                  summary: ev.summary,
                });
                break;
              case "file_write":
                currentStore.addLog(taskId, {
                  type: "file_write",
                  ts: ev.ts || Date.now(),
                  path: ev.path || "",
                  bytes: ev.bytes,
                });
                break;
              case "metric":
                currentStore.addLog(taskId, {
                  type: "metric",
                  ts: ev.ts || Date.now(),
                  key: ev.key || "",
                  value: ev.value ?? 0,
                  unit: ev.unit,
                });
                break;
              case "artifact":
                currentStore.addLog(taskId, {
                  type: "artifact",
                  ts: ev.ts || Date.now(),
                  kind: ev.kind || "artifact",
                  content: ev.content,
                });
                break;
              case "error":
                currentStore.addLog(taskId, {
                  type: "text",
                  ts: ev.ts || Date.now(),
                  level: "error",
                  content: `error: ${ev.message || "Unknown error"}`,
                });
                currentStore.setRunning(taskId, false);
                break;
              case "done":
                currentStore.addLog(taskId, {
                  type: "text",
                  ts: ev.ts || Date.now(),
                  content: ev.success
                    ? "Agent run completed"
                    : "Agent run ended with errors",
                });
                currentStore.setRunning(taskId, false);
                // Clean up subscription when done
                currentStore.setUnsubscribe(taskId, null);
                break;
              default:
                currentStore.addLog(taskId, `event: ${JSON.stringify(ev)}`);
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
      selectRepositoryForTask: async (taskId: string) => {
        const store = get();
        try {
          const selected = await window.electronAPI?.selectDirectory();
          if (selected) {
            const isRepo = await window.electronAPI?.validateRepo(selected);
            if (!isRepo) {
              store.addLog(
                taskId,
                `Selected folder is not a git repository: ${selected}`,
              );
              return;
            }
            const canWrite =
              await window.electronAPI?.checkWriteAccess(selected);
            if (!canWrite) {
              store.addLog(
                taskId,
                `No write permission in selected folder: ${selected}`,
              );
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
                return store.selectRepositoryForTask(taskId);
              }
              return;
            }
            store.setRepoPath(taskId, selected);
          }
        } catch (err) {
          store.addLog(
            taskId,
            `Error selecting directory: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      },

      runTask: async (taskId: string, fallbackTask: Task) => {
        const store = get();
        const taskState = store.getTaskState(taskId);

        if (taskState.isRunning) return;

        const currentTask =
          useTaskStore
            .getState()
            .tasks.find((candidate) => candidate.id === taskId) ??
          fallbackTask;

        if (!currentTask.workflow) {
          store.addLog(
            taskId,
            "Select a PostHog workflow before running the agent.",
          );
          return;
        }

        const { apiKey, apiHost } = useAuthStore.getState();
        if (!apiKey) {
          store.addLog(
            taskId,
            "No PostHog API key found. Sign in to PostHog to run workflows.",
          );
          return;
        }

        // Ensure repo path is selected
        let effectiveRepoPath = taskState.repoPath;
        if (!effectiveRepoPath) {
          await store.selectRepositoryForTask(taskId);
          effectiveRepoPath = store.getTaskState(taskId).repoPath;
        }

        if (!effectiveRepoPath) {
          store.addLog(taskId, "No repository folder selected.");
          return;
        }

        const isRepo =
          await window.electronAPI?.validateRepo(effectiveRepoPath);
        if (!isRepo) {
          store.addLog(
            taskId,
            `Selected folder is not a git repository: ${effectiveRepoPath}`,
          );
          return;
        }

        const canWrite =
          await window.electronAPI?.checkWriteAccess(effectiveRepoPath);
        if (!canWrite) {
          store.addLog(
            taskId,
            `No write permission in selected folder: ${effectiveRepoPath}`,
          );
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
        const workflowName =
          useWorkflowStore
            .getState()
            .workflows.find((w) => w.id === currentTask.workflow)?.name ??
          currentTask.workflow;
        const permissionMode =
          currentTaskState.runMode === "cloud" ? "default" : "acceptEdits";

        store.setProgress(taskId, null);
        store.setRunning(taskId, true);
        const startTs = Date.now();
        store.setLogs(taskId, [
          {
            type: "text",
            ts: startTs,
            content: `Starting workflow run (${workflowName})...`,
          },
          {
            type: "text",
            ts: startTs,
            content: `Permission mode: ${permissionMode}`,
          },
          {
            type: "text",
            ts: startTs,
            content: `Repo: ${effectiveRepoPath}`,
          },
        ]);

        try {
          const result = await window.electronAPI?.agentStart({
            taskId: currentTask.id,
            workflowId: currentTask.workflow,
            repoPath: effectiveRepoPath,
            apiKey,
            apiHost,
            permissionMode,
            autoProgress: true,
          });
          if (!result) {
            store.addLog(
              taskId,
              "Failed to start agent: electronAPI not available",
            );
            store.setRunning(taskId, false);
            return;
          }
          const { taskId: executionTaskId, channel } = result;

          store.setCurrentTaskId(taskId, executionTaskId);

          // Subscribe to streaming events using store-managed subscription
          store.subscribeToAgentEvents(taskId, channel);
        } catch (error) {
          store.addLog(
            taskId,
            `Error starting agent: ${error instanceof Error ? error.message : "Unknown error"}`,
          );
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

        store.setRunning(taskId, false);
        store.unsubscribeFromAgentEvents(taskId);
      },

      clearTaskLogs: (taskId: string) => {
        get().setLogs(taskId, []);
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
