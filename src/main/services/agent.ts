import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Agent, PermissionMode } from "@posthog/agent";
import { type BrowserWindow, type IpcMainInvokeEvent, ipcMain } from "electron";
import { buildPlanningPrompt } from "../prompts/generate-plan.js";
import { buildResearchPrompt } from "../prompts/research-questions.js";

interface AgentStartParams {
  taskId: string;
  workflowId: string;
  repoPath: string;
  apiKey: string;
  apiHost: string;
  permissionMode?: PermissionMode | string;
  autoProgress?: boolean;
  model?: string;
}

export interface TaskController {
  abortController: AbortController;
  agent: Agent;
  channel: string;
  taskId: string;
  poller?: NodeJS.Timeout;
}

function resolvePermissionMode(
  mode: AgentStartParams["permissionMode"],
): PermissionMode {
  if (!mode) return PermissionMode.ACCEPT_EDITS;
  if (typeof mode !== "string") return mode;

  const normalized = mode.trim().toLowerCase();
  const match = (Object.values(PermissionMode) as string[]).find(
    (value) => value.toLowerCase() === normalized,
  );

  return (match as PermissionMode | undefined) ?? PermissionMode.ACCEPT_EDITS;
}

export function registerAgentIpc(
  taskControllers: Map<string, TaskController>,
  getMainWindow: () => BrowserWindow | null,
): void {
  ipcMain.handle(
    "agent-start",
    async (
      _event: IpcMainInvokeEvent,
      {
        taskId: posthogTaskId,
        workflowId,
        repoPath,
        apiKey,
        apiHost,
        permissionMode,
        autoProgress,
        model,
      }: AgentStartParams,
    ): Promise<{ taskId: string; channel: string }> => {
      if (!posthogTaskId || !workflowId || !repoPath) {
        throw new Error("taskId, workflowId, and repoPath are required");
      }

      if (!apiKey || !apiHost) {
        throw new Error("PostHog API credentials are required");
      }

      // Provide credentials to the PostHog MCP server used inside the agent runtime.
      process.env.POSTHOG_API_KEY = apiKey;
      process.env.POSTHOG_API_HOST = apiHost;

      const taskId = randomUUID();
      const channel = `agent-event:${taskId}`;

      const abortController = new AbortController();
      const stderrBuffer: string[] = [];

      const emitToRenderer = (payload: unknown) => {
        const win = getMainWindow?.();
        if (!win || win.isDestroyed()) return;
        win.webContents.send(channel, payload);
      };

      const forwardClaudeStderr = (chunk: string | Buffer) => {
        const text = chunk.toString().trim();
        if (!text) return;
        stderrBuffer.push(text);
        if (stderrBuffer.length > 50) {
          stderrBuffer.shift();
        }
        console.error(`[agent][claude-stderr] ${text}`);
        emitToRenderer({
          type: "status",
          ts: Date.now(),
          message: `[Claude stderr] ${text}`,
        });
      };

      const agent = new Agent({
        workingDirectory: repoPath,
        posthogApiKey: apiKey,
        posthogApiUrl: apiHost,
        onEvent: (event) => {
          console.log("agent event", event);
          if (!event || abortController.signal.aborted) return;
          const payload =
            event.type === "done" ? { ...event, success: true } : event;
          emitToRenderer(payload);
        },
        debug: true,
      });

      const controllerEntry: TaskController = {
        abortController,
        agent,
        channel,
        taskId: posthogTaskId,
      };

      taskControllers.set(taskId, controllerEntry);

      const posthogClient = agent.getPostHogClient();
      if (posthogClient) {
        const pollTaskProgress = async () => {
          if (abortController.signal.aborted) return;
          try {
            const progress = await posthogClient.getTaskProgress(posthogTaskId);
            if (progress?.has_progress) {
              emitToRenderer({
                type: "progress",
                ts: Date.now(),
                progress,
              });
            }
          } catch (err) {
            console.warn("[agent] failed to fetch task progress", err);
          }
        };

        void pollTaskProgress();
        controllerEntry.poller = setInterval(() => {
          void pollTaskProgress();
        }, 5000);
      }

      emitToRenderer({
        type: "status",
        ts: Date.now(),
        phase: "workflow_start",
        workflowId,
        taskId: posthogTaskId,
      });

      (async () => {
        const resolvedPermission = resolvePermissionMode(permissionMode);
        try {
          const envOverrides = {
            ...process.env,
            POSTHOG_API_KEY: apiKey,
            POSTHOG_API_HOST: apiHost,
            POSTHOG_AUTH_HEADER: `Bearer ${apiKey}`,
          };

          const mcpOverrides = {};

          await agent.runWorkflow(posthogTaskId, workflowId, {
            repositoryPath: repoPath,
            permissionMode: resolvedPermission,
            autoProgress: autoProgress ?? true,
            queryOverrides: {
              abortController,
              ...(model ? { model } : {}),
              stderr: forwardClaudeStderr,
              env: envOverrides,
              mcpServers: mcpOverrides,
            },
          });
          emitToRenderer({ type: "done", success: true, ts: Date.now() });
        } catch (err) {
          console.error("[agent] workflow execution failed", err);
          let errorMessage = err instanceof Error ? err.message : String(err);
          const cause =
            err instanceof Error && "cause" in err && err.cause
              ? ` (cause: ${String(err.cause)})`
              : "";
          if (!abortController.signal.aborted) {
            if (stderrBuffer.length > 0) {
              const stderrSummary = stderrBuffer.slice(-5).join("\n");
              errorMessage += `\nLast Claude stderr:\n${stderrSummary}`;
            }
            emitToRenderer({
              type: "error",
              message: `${errorMessage}${cause}`,
              ts: Date.now(),
            });
            emitToRenderer({ type: "done", success: false, ts: Date.now() });
          } else {
            emitToRenderer({
              type: "status",
              ts: Date.now(),
              phase: "canceled",
            });
            emitToRenderer({ type: "done", success: false, ts: Date.now() });
          }
        } finally {
          if (controllerEntry.poller) {
            clearInterval(controllerEntry.poller);
          }
          taskControllers.delete(taskId);
        }
      })();

      return { taskId, channel };
    },
  );

  ipcMain.handle(
    "agent-cancel",
    async (_event: IpcMainInvokeEvent, taskId: string): Promise<boolean> => {
      const entry = taskControllers.get(taskId);
      if (!entry) return false;
      try {
        entry.abortController.abort();
        entry.agent.cancelTask(entry.taskId);
        if (entry.poller) {
          clearInterval(entry.poller);
        }
        return true;
      } finally {
        taskControllers.delete(taskId);
      }
    },
  );

  // Plan mode: Research and generate questions
  ipcMain.handle(
    "agent-start-plan-mode",
    async (
      _event: IpcMainInvokeEvent,
      {
        taskId: posthogTaskId,
        taskTitle,
        taskDescription,
        repoPath,
        apiKey,
        apiHost,
      }: {
        taskId: string;
        taskTitle: string;
        taskDescription: string;
        repoPath: string;
        apiKey: string;
        apiHost: string;
      },
    ): Promise<{ taskId: string; channel: string }> => {
      const taskId = randomUUID();
      const channel = `agent-event-${taskId}`;
      const abortController = new AbortController();

      const mainWindow = getMainWindow();
      if (!mainWindow) {
        throw new Error("Main window not found");
      }

      const emitToRenderer = (payload: unknown) => {
        if (abortController.signal.aborted) return;
        mainWindow.webContents.send(channel, payload);
      };

      const agent = new Agent({
        workingDirectory: repoPath,
        posthogApiKey: apiKey,
        posthogApiUrl: apiHost,
        onEvent: (event) => {
          if (!event || abortController.signal.aborted) return;
          emitToRenderer(event);
        },
        debug: true,
      });

      const controllerEntry: TaskController = {
        abortController,
        agent,
        channel,
        taskId: posthogTaskId,
      };

      taskControllers.set(taskId, controllerEntry);

      emitToRenderer({
        type: "status",
        ts: Date.now(),
        phase: "research_start",
      });

      (async () => {
        try {
          const envOverrides = {
            ...process.env,
            POSTHOG_API_KEY: apiKey,
            POSTHOG_API_HOST: apiHost,
            POSTHOG_AUTH_HEADER: `Bearer ${apiKey}`,
          };

          const researchPrompt = buildResearchPrompt(
            taskTitle,
            taskDescription,
          );

          await agent.run(researchPrompt, {
            repositoryPath: repoPath,
            permissionMode: "plan" as PermissionMode,
            queryOverrides: {
              abortController,
              stderr: (text: string) => {
                emitToRenderer({
                  type: "token",
                  ts: Date.now(),
                  message: `[Agent stderr] ${text}`,
                });
              },
              env: envOverrides,
            },
          });

          // After agent finishes, signal completion
          emitToRenderer({ type: "done", success: true, ts: Date.now() });
        } catch (err) {
          console.error("[plan-mode] research execution failed", err);
          const errorMessage = err instanceof Error ? err.message : String(err);
          if (!abortController.signal.aborted) {
            emitToRenderer({
              type: "error",
              message: errorMessage,
              ts: Date.now(),
            });
            emitToRenderer({ type: "done", success: false, ts: Date.now() });
          } else {
            emitToRenderer({
              type: "status",
              ts: Date.now(),
              phase: "canceled",
            });
            emitToRenderer({ type: "done", success: false, ts: Date.now() });
          }
        } finally {
          taskControllers.delete(taskId);
        }
      })();

      return { taskId, channel };
    },
  );

  // Plan mode: Generate plan from question answers
  ipcMain.handle(
    "agent-generate-plan",
    async (
      _event: IpcMainInvokeEvent,
      {
        taskId: posthogTaskId,
        taskTitle,
        taskDescription,
        repoPath,
        questionAnswers,
        apiKey,
        apiHost,
      }: {
        taskId: string;
        taskTitle: string;
        taskDescription: string;
        repoPath: string;
        questionAnswers: Array<{
          questionId: string;
          selectedOption: string;
          customInput?: string;
        }>;
        apiKey: string;
        apiHost: string;
      },
    ): Promise<{ taskId: string; channel: string }> => {
      const taskId = randomUUID();
      const channel = `agent-event-${taskId}`;
      const abortController = new AbortController();

      const mainWindow = getMainWindow();
      if (!mainWindow) {
        throw new Error("Main window not found");
      }

      const emitToRenderer = (payload: unknown) => {
        if (abortController.signal.aborted) return;
        mainWindow.webContents.send(channel, payload);
      };

      const agent = new Agent({
        workingDirectory: repoPath,
        posthogApiKey: apiKey,
        posthogApiUrl: apiHost,
        onEvent: (event) => {
          if (!event || abortController.signal.aborted) return;
          emitToRenderer(event);
        },
        debug: true,
      });

      const controllerEntry: TaskController = {
        abortController,
        agent,
        channel,
        taskId: posthogTaskId,
      };

      taskControllers.set(taskId, controllerEntry);

      emitToRenderer({
        type: "status",
        ts: Date.now(),
        phase: "planning_start",
      });

      (async () => {
        try {
          const envOverrides = {
            ...process.env,
            POSTHOG_API_KEY: apiKey,
            POSTHOG_API_HOST: apiHost,
            POSTHOG_AUTH_HEADER: `Bearer ${apiKey}`,
          };

          const planningPrompt = buildPlanningPrompt(
            taskTitle,
            taskDescription,
            questionAnswers,
          );

          let planContent = "";
          const results = await agent.run(planningPrompt, {
            repositoryPath: repoPath,
            permissionMode: "plan" as PermissionMode,
            queryOverrides: {
              abortController,
              stderr: (text: string) => {
                emitToRenderer({
                  type: "token",
                  ts: Date.now(),
                  message: `[Agent stderr] ${text}`,
                });
              },
              env: envOverrides,
            },
          });

          // Extract plan content from agent results
          for (const message of results.results) {
            if (message.type === "assistant" && message.message?.content) {
              for (const content of message.message.content) {
                if (content.type === "text" && content.text) {
                  planContent += `${content.text}\n`;
                }
              }
            }
          }

          // Write plan to .posthog/{taskId}/plan.md
          if (planContent.trim()) {
            try {
              const planPath = join(
                repoPath,
                ".posthog",
                posthogTaskId,
                "plan.md",
              );
              const { mkdirSync } = await import("node:fs");
              mkdirSync(join(repoPath, ".posthog", posthogTaskId), {
                recursive: true,
              });
              writeFileSync(planPath, planContent.trim(), "utf-8");
              emitToRenderer({
                type: "status",
                ts: Date.now(),
                phase: "plan_written",
                planPath,
              });
            } catch (writeError) {
              console.error(
                "[plan-mode] Failed to write plan file",
                writeError,
              );
              emitToRenderer({
                type: "error",
                message: `Failed to write plan file: ${writeError instanceof Error ? writeError.message : String(writeError)}`,
                ts: Date.now(),
              });
            }
          }

          emitToRenderer({ type: "done", success: true, ts: Date.now() });
        } catch (err) {
          console.error("[plan-mode] plan generation failed", err);
          const errorMessage = err instanceof Error ? err.message : String(err);
          if (!abortController.signal.aborted) {
            emitToRenderer({
              type: "error",
              message: errorMessage,
              ts: Date.now(),
            });
            emitToRenderer({ type: "done", success: false, ts: Date.now() });
          } else {
            emitToRenderer({
              type: "status",
              ts: Date.now(),
              phase: "canceled",
            });
            emitToRenderer({ type: "done", success: false, ts: Date.now() });
          }
        } finally {
          taskControllers.delete(taskId);
        }
      })();

      return { taskId, channel };
    },
  );
}
