import { Agent, PermissionMode } from "@posthog/agent";
import { type BrowserWindow, type IpcMainInvokeEvent, ipcMain } from "electron";
import { randomUUID } from "node:crypto";

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
          let errorMessage =
            err instanceof Error ? err.message : String(err);
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
}
