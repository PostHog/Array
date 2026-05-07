import { getAuthenticatedClient } from "@features/auth/hooks/authClient";
import { fetchAuthState } from "@features/auth/hooks/authQueries";
import { DISCOVERY_PROMPT, WIZARD_PROMPT } from "@features/setup/prompts";
import { useSetupStore } from "@features/setup/stores/setupStore";
import {
  type DiscoveredTask,
  TASK_DISCOVERY_JSON_SCHEMA,
} from "@features/setup/types";
import type { PostHogAPIClient } from "@renderer/api/posthogClient";
import {
  type TaskCreationInput,
  TaskCreationSaga,
} from "@renderer/sagas/task/task-creation";
import { trpcClient } from "@renderer/trpc/client";
import { isTerminalStatus, type Task } from "@shared/types";
import { ANALYTICS_EVENTS } from "@shared/types/analytics";
import { getCloudUrlFromRegion } from "@shared/utils/urls";
import { captureException, track } from "@utils/analytics";
import { logger } from "@utils/logger";
import { queryClient } from "@utils/queryClient";
import { injectable } from "inversify";

const log = logger.scope("setup-run-service");

interface ActivityEntry {
  id: number;
  toolCallId: string;
  tool: string;
  filePath: string | null;
  title: string;
}

let activityIdCounter = 0;

function extractPathFromRawInput(
  tool: string,
  rawInput: Record<string, unknown> | undefined,
): string | null {
  if (!rawInput) return null;

  switch (tool) {
    case "Read":
    case "Edit":
    case "Write":
      return (rawInput.file_path as string) ?? null;
    case "Grep":
      return (rawInput.pattern as string)
        ? `"${rawInput.pattern}"${rawInput.path ? ` in ${rawInput.path}` : ""}`
        : ((rawInput.path as string) ?? null);
    case "Glob":
      return (rawInput.pattern as string) ?? null;
    case "Bash": {
      const cmd = rawInput.command as string | undefined;
      if (!cmd) return null;
      return cmd.length > 80 ? `${cmd.slice(0, 77)}...` : cmd;
    }
    default: {
      const filePath =
        rawInput.file_path ?? rawInput.path ?? rawInput.notebook_path;
      if (typeof filePath === "string") return filePath;
      const pattern = rawInput.pattern;
      if (typeof pattern === "string") return `"${pattern}"`;
      const command = rawInput.command;
      if (typeof command === "string")
        return command.length > 80 ? `${command.slice(0, 77)}...` : command;
      const url = rawInput.url;
      if (typeof url === "string") return url;
      const query = rawInput.query;
      if (typeof query === "string") return query;
      return null;
    }
  }
}

function extractToolCall(
  update: Record<string, unknown>,
): ActivityEntry | null {
  const sessionUpdate = update.sessionUpdate as string | undefined;
  if (sessionUpdate !== "tool_call" && sessionUpdate !== "tool_call_update")
    return null;

  const meta = update._meta as
    | { claudeCode?: { toolName?: string } }
    | undefined;
  const tool = meta?.claudeCode?.toolName ?? "Working";
  const locations = update.locations as
    | { path?: string; line?: number }[]
    | undefined;
  const rawInput = (update.rawInput ?? update.input) as
    | Record<string, unknown>
    | undefined;
  const filePath =
    locations?.[0]?.path ?? extractPathFromRawInput(tool, rawInput);
  const title = (update.title as string) ?? "";
  const toolCallId = (update.toolCallId as string) ?? "";

  activityIdCounter += 1;
  return { id: activityIdCounter, toolCallId, tool, filePath, title };
}

function extractAgentMessageText(
  update: Record<string, unknown>,
): string | null {
  if (update.sessionUpdate !== "agent_message_chunk") return null;
  const content = update.content as
    | { type?: string; text?: string }
    | undefined;
  if (content?.type !== "text" || !content.text) return null;
  return content.text;
}

function handleSessionUpdate(
  payload: unknown,
  pushActivity: (entry: ActivityEntry) => void,
  pushAssistantText?: (text: string) => void,
) {
  const acpMsg = payload as { message?: Record<string, unknown> };
  const inner = acpMsg.message;
  if (!inner) return;

  if ("method" in inner && inner.method === "session/update") {
    const params = inner.params as Record<string, unknown> | undefined;
    if (!params) return;

    const update = (params.update as Record<string, unknown>) ?? params;

    const entry = extractToolCall(update);
    if (entry) {
      pushActivity(entry);
      return;
    }

    if (pushAssistantText) {
      const text = extractAgentMessageText(update);
      if (text) pushAssistantText(text);
    }
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

const POSTHOG_PACKAGES = [
  "posthog-js",
  "posthog-node",
  "posthog-react-native",
  "@posthog/react-native-session-replay",
  "posthog-android",
  "posthog-ios",
  "posthog-flutter",
];

async function isPosthogInstalled(repoPath: string): Promise<boolean> {
  try {
    const content = await trpcClient.fs.readRepoFile.query({
      repoPath,
      filePath: "package.json",
    });
    if (!content) return false;
    const pkg = JSON.parse(content);
    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };
    return POSTHOG_PACKAGES.some((name) => name in allDeps);
  } catch {
    return false;
  }
}

async function resolveWizardWorkspaceMode(
  client: PostHogAPIClient,
): Promise<"cloud" | "local"> {
  try {
    const integrations = await client.getIntegrations();
    const hasGithub = (integrations as { kind: string }[]).some(
      (i) => i.kind === "github",
    );
    if (hasGithub) return "cloud";
  } catch (err) {
    log.warn("Failed to check GitHub integration, falling back to local", {
      error: err,
    });
  }
  return "local";
}

@injectable()
export class SetupRunService {
  private discoverySubscription: { unsubscribe: () => void } | null = null;
  private wizardSubscription: { unsubscribe: () => void } | null = null;
  private discoveryAbort: AbortController | null = null;
  private wizardAbort: AbortController | null = null;
  private discoveryStartedAt: number | null = null;
  private discoveryStarting = false;
  private wizardStarting = false;

  startDiscovery(directory: string): void {
    if (this.discoveryStarting) return;
    const status = useSetupStore.getState().discoveryStatus;
    if (status === "running" || status === "done") return;
    this.discoveryStarting = true;
    this.runDiscovery(directory)
      .catch((err) => {
        log.error("Discovery startup failed", { error: err });
      })
      .finally(() => {
        this.discoveryStarting = false;
      });
  }

  startWizard(directory: string): void {
    if (this.wizardStarting) return;
    const state = useSetupStore.getState();
    if (state.wizardTaskId || state.wizardSkipped) return;
    this.wizardStarting = true;
    this.runWizard(directory)
      .catch((err) => {
        log.error("Wizard startup failed", { error: err });
      })
      .finally(() => {
        this.wizardStarting = false;
      });
  }

  cancel(): void {
    this.discoveryAbort?.abort();
    this.discoveryAbort = null;
    this.wizardAbort?.abort();
    this.wizardAbort = null;
    this.discoverySubscription = null;
    this.wizardSubscription = null;
    this.discoveryStartedAt = null;
    useSetupStore.getState().resetDiscovery();
  }

  private async runWizard(directory: string): Promise<void> {
    const existingId = useSetupStore.getState().wizardTaskId;
    if (existingId) {
      log.debug("Wizard task already exists, skipping", {
        wizardTaskId: existingId,
      });
      return;
    }

    this.wizardAbort?.abort();
    const abort = new AbortController();
    this.wizardAbort = abort;

    log.debug("Starting wizard task");
    try {
      const client = await getAuthenticatedClient();
      if (abort.signal.aborted) return;
      if (!client) {
        log.error("getAuthenticatedClient returned null for wizard");
        track(ANALYTICS_EVENTS.SETUP_WIZARD_FAILED, {
          reason: "unauthenticated_client",
        });
        return;
      }

      if (!directory) {
        log.warn("No directory for wizard task");
        track(ANALYTICS_EVENTS.SETUP_WIZARD_FAILED, {
          reason: "missing_directory",
        });
        return;
      }

      if (await isPosthogInstalled(directory)) {
        if (abort.signal.aborted) return;
        log.info("PostHog already installed, skipping wizard");
        useSetupStore.getState().skipWizard();
        track(ANALYTICS_EVENTS.SETUP_WIZARD_FAILED, {
          reason: "already_installed",
        });
        return;
      }

      const workspaceMode = await resolveWizardWorkspaceMode(client);
      if (abort.signal.aborted) return;
      log.info("Wizard workspace mode resolved", { workspaceMode });

      const sagaInput: TaskCreationInput = {
        taskDescription: WIZARD_PROMPT,
        content: WIZARD_PROMPT,
        repoPath: directory,
        workspaceMode,
        executionMode: "auto",
      };

      const saga = new TaskCreationSaga({
        posthogClient: client,
        onTaskReady: ({ task }) => {
          if (abort.signal.aborted) return;
          useSetupStore.getState().setWizardTaskId(task.id);
          track(ANALYTICS_EVENTS.SETUP_WIZARD_STARTED, {
            wizard_task_id: task.id,
            workspace_mode: workspaceMode,
          });
          queryClient.invalidateQueries({ queryKey: ["tasks", "list"] });
          this.subscribeToWizardEvents(task.id, abort.signal);
        },
      });

      const result = await saga.run(sagaInput);
      if (abort.signal.aborted) return;

      if (!result.success) {
        throw new Error(
          `Wizard saga failed at step: ${result.failedStep ?? "unknown"}`,
        );
      }
    } catch (err) {
      if (abort.signal.aborted) return;
      log.error("Failed to start wizard task", { error: err });
      const message =
        err instanceof Error ? err.message : "Failed to start wizard task.";
      track(ANALYTICS_EVENTS.SETUP_WIZARD_FAILED, {
        reason: "startup_error",
        error_message: message,
      });
      if (err instanceof Error) {
        captureException(err, { scope: "setup.start_wizard_task" });
      }
    } finally {
      if (this.wizardAbort === abort) {
        this.wizardAbort = null;
      }
    }
  }

  private subscribeToWizardEvents(taskId: string, signal: AbortSignal): void {
    const run = async () => {
      const client = await getAuthenticatedClient();
      if (!client || signal.aborted) return;

      let runId: string | null = null;
      for (let i = 0; i < 30; i++) {
        try {
          await sleep(2000, signal);
        } catch {
          return; // aborted
        }
        try {
          const taskData = (await client.getTask(taskId)) as unknown as Task;
          if (signal.aborted) return;
          if (taskData.latest_run?.id) {
            runId = taskData.latest_run.id;
            break;
          }
        } catch {
          // keep polling
        }
      }

      if (!runId || signal.aborted) return;

      log.debug("Wizard run found, subscribing", { taskId, runId });
      const sub = trpcClient.agent.onSessionEvent.subscribe(
        { taskRunId: runId },
        {
          onData: (payload: unknown) => {
            handleSessionUpdate(payload, (entry) => {
              useSetupStore.getState().pushWizardActivity(entry);
            });
          },
          onError: (err) => {
            log.error("Wizard subscription error", { error: err });
          },
        },
      );
      this.wizardSubscription = sub;
      signal.addEventListener(
        "abort",
        () => {
          sub.unsubscribe();
          if (this.wizardSubscription === sub) {
            this.wizardSubscription = null;
          }
        },
        { once: true },
      );

      const POLL_INTERVAL_MS = 5000;
      const MAX_ATTEMPTS = 360; // 30 minutes
      for (let i = 0; i < MAX_ATTEMPTS; i++) {
        try {
          await sleep(POLL_INTERVAL_MS, signal);
        } catch {
          return; // aborted
        }
        if (useSetupStore.getState().wizardCompleted) return;
        try {
          const taskRun = await client.getTaskRun(taskId, runId);
          if (signal.aborted) return;
          if (isTerminalStatus(taskRun.status)) {
            log.info("Wizard task reached terminal status", {
              taskId,
              runId,
              status: taskRun.status,
            });
            if (taskRun.status === "completed") {
              useSetupStore.getState().completeWizard();
            } else {
              useSetupStore.getState().skipWizard();
              track(ANALYTICS_EVENTS.SETUP_WIZARD_FAILED, {
                reason: "task_run_terminal",
                error_message: taskRun.status,
              });
            }
            return;
          }
        } catch (err) {
          log.warn("Failed to poll wizard task run", { error: err });
        }
      }
    };
    run().catch((err) =>
      log.error("Wizard event subscribe failed", { error: err }),
    );
  }

  private async runDiscovery(directory: string): Promise<void> {
    const state = useSetupStore.getState();
    if (
      state.discoveryStatus === "done" ||
      state.discoveryStatus === "running"
    ) {
      return;
    }

    this.discoveryAbort?.abort();
    const abort = new AbortController();
    this.discoveryAbort = abort;

    try {
      const authState = await fetchAuthState();
      if (abort.signal.aborted) return;
      const apiHost = authState.cloudRegion
        ? getCloudUrlFromRegion(authState.cloudRegion)
        : null;
      const projectId = authState.projectId;

      if (!apiHost || !projectId) {
        log.error("Missing auth for discovery", { apiHost, projectId });
        useSetupStore.getState().failDiscovery("Authentication required.");
        track(ANALYTICS_EVENTS.SETUP_DISCOVERY_FAILED, {
          reason: "startup_error",
          error_message: "missing_auth",
        });
        return;
      }

      const client = await getAuthenticatedClient();
      if (abort.signal.aborted) return;
      if (!client) {
        useSetupStore.getState().failDiscovery("Authentication required.");
        track(ANALYTICS_EVENTS.SETUP_DISCOVERY_FAILED, {
          reason: "startup_error",
          error_message: "unauthenticated_client",
        });
        return;
      }

      if (!directory) {
        useSetupStore.getState().failDiscovery("No directory selected.");
        track(ANALYTICS_EVENTS.SETUP_DISCOVERY_FAILED, {
          reason: "startup_error",
          error_message: "missing_directory",
        });
        return;
      }

      const task = (await client.createTask({
        title: "Discover first tasks",
        description: DISCOVERY_PROMPT,
        json_schema: TASK_DISCOVERY_JSON_SCHEMA as Record<string, unknown>,
      })) as unknown as Task;
      if (abort.signal.aborted) return;

      const taskRun = await client.createTaskRun(task.id);
      if (abort.signal.aborted) return;
      if (!taskRun?.id) {
        throw new Error("Failed to create discovery task run");
      }

      useSetupStore.getState().startDiscovery(task.id, taskRun.id);
      this.discoveryStartedAt = Date.now();
      track(ANALYTICS_EVENTS.SETUP_DISCOVERY_STARTED, {
        discovery_task_id: task.id,
        discovery_task_run_id: taskRun.id,
      });

      await trpcClient.agent.start.mutate({
        taskId: task.id,
        taskRunId: taskRun.id,
        repoPath: directory,
        apiHost,
        projectId,
        permissionMode: "bypassPermissions",
        jsonSchema: TASK_DISCOVERY_JSON_SCHEMA as Record<string, unknown>,
      });
      if (abort.signal.aborted) return;

      trpcClient.agent.prompt
        .mutate({
          sessionId: taskRun.id,
          prompt: [{ type: "text", text: DISCOVERY_PROMPT }],
        })
        .catch((err) => {
          log.error("Failed to send discovery prompt", { error: err });
        });

      let completed = false;
      let subscription: { unsubscribe: () => void } | null = null;

      type CompletionSource =
        | "structured_output"
        | "terminal_status"
        | "missing_output";

      const finishSuccess = (
        tasks: DiscoveredTask[],
        signalSource: CompletionSource,
      ) => {
        if (completed || abort.signal.aborted) return;
        completed = true;
        subscription?.unsubscribe();
        if (this.discoverySubscription === subscription) {
          this.discoverySubscription = null;
        }

        const startedAt = this.discoveryStartedAt;
        const durationSeconds = startedAt
          ? Math.round((Date.now() - startedAt) / 1000)
          : 0;

        log.info("Discovery completed", {
          taskCount: tasks.length,
          signalSource,
        });
        useSetupStore.getState().completeDiscovery(tasks);
        track(ANALYTICS_EVENTS.SETUP_DISCOVERY_COMPLETED, {
          discovery_task_id: task.id,
          discovery_task_run_id: taskRun.id,
          task_count: tasks.length,
          duration_seconds: durationSeconds,
          signal_source: signalSource,
        });
      };

      const finishFailure = (
        reason: "failed" | "cancelled" | "timeout",
        message: string,
      ) => {
        if (completed || abort.signal.aborted) return;
        completed = true;
        subscription?.unsubscribe();
        if (this.discoverySubscription === subscription) {
          this.discoverySubscription = null;
        }

        log.error("Discovery failed", { reason });
        useSetupStore.getState().failDiscovery(message);
        track(ANALYTICS_EVENTS.SETUP_DISCOVERY_FAILED, {
          discovery_task_id: task.id,
          discovery_task_run_id: taskRun.id,
          reason,
        });
      };

      let signalRetryStarted = false;
      const handleStructuredOutputSignal = async () => {
        if (signalRetryStarted) return;
        signalRetryStarted = true;
        const startedAt = Date.now();
        const TIMEOUT_MS = 8000;
        const MAX_DELAY_MS = 4000;
        let delay = 500;
        while (Date.now() - startedAt < TIMEOUT_MS) {
          try {
            await sleep(delay, abort.signal);
          } catch {
            return; // aborted
          }
          if (completed) return;
          try {
            const run = await client.getTaskRun(task.id, taskRun.id);
            if (completed || abort.signal.aborted) return;
            const output = run.output as { tasks?: DiscoveredTask[] } | null;
            if (output?.tasks) {
              finishSuccess(output.tasks, "structured_output");
              return;
            }
          } catch (err) {
            log.warn("Failed to fetch run after StructuredOutput signal", {
              error: err,
            });
          }
          delay = Math.min(delay * 2, MAX_DELAY_MS);
        }
      };

      let structuredOutputSeen = false;
      let wrapupBuffer = "";
      const WRAPUP_TOOL_CALL_ID = "discovery-wrapup";
      const pushWrapupActivity = (text: string) => {
        if (!structuredOutputSeen) return;
        wrapupBuffer = (wrapupBuffer + text).slice(-200);
        activityIdCounter += 1;
        useSetupStore.getState().pushDiscoveryActivity({
          id: activityIdCounter,
          toolCallId: WRAPUP_TOOL_CALL_ID,
          tool: "WrappingUp",
          filePath: null,
          title: wrapupBuffer.trim(),
        });
      };

      subscription = trpcClient.agent.onSessionEvent.subscribe(
        { taskRunId: taskRun.id },
        {
          onData: (payload: unknown) => {
            handleSessionUpdate(
              payload,
              (entry) => {
                useSetupStore.getState().pushDiscoveryActivity(entry);
                if (entry.tool === "StructuredOutput") {
                  structuredOutputSeen = true;
                  handleStructuredOutputSignal().catch((err) =>
                    log.warn("StructuredOutput handler failed", { error: err }),
                  );
                }
              },
              pushWrapupActivity,
            );
          },
          onError: (err) => {
            log.error("Discovery subscription error", { error: err });
          },
        },
      );
      this.discoverySubscription = subscription;
      const subscriptionAtAbort = subscription;
      abort.signal.addEventListener(
        "abort",
        () => {
          subscriptionAtAbort.unsubscribe();
          if (this.discoverySubscription === subscriptionAtAbort) {
            this.discoverySubscription = null;
          }
        },
        { once: true },
      );

      const pollForCompletion = async () => {
        const maxAttempts = 120;
        const intervalMs = 5000;

        for (let i = 0; i < maxAttempts; i++) {
          try {
            await sleep(intervalMs, abort.signal);
          } catch {
            return; // aborted
          }
          if (completed) return;

          try {
            const run = await client.getTaskRun(task.id, taskRun.id);
            if (completed || abort.signal.aborted) return;

            const output = run.output as { tasks?: DiscoveredTask[] } | null;

            if (isTerminalStatus(run.status)) {
              if (run.status === "completed" && output?.tasks) {
                finishSuccess(output.tasks, "terminal_status");
              } else if (
                run.status === "failed" ||
                run.status === "cancelled"
              ) {
                finishFailure(
                  run.status,
                  "Discovery failed. You can skip or retry.",
                );
              } else {
                finishSuccess([], "missing_output");
              }
              return;
            }

            if (output?.tasks) {
              finishSuccess(output.tasks, "missing_output");
              return;
            }
          } catch (err) {
            log.warn("Failed to poll discovery", {
              attempt: i + 1,
              error: err,
            });
          }
        }

        finishFailure("timeout", "Discovery timed out. You can skip or retry.");
      };

      pollForCompletion().catch((err) => {
        if (abort.signal.aborted) return;
        log.error("Discovery poll failed", { error: err });
        if (!completed) {
          completed = true;
          subscription?.unsubscribe();
          if (this.discoverySubscription === subscription) {
            this.discoverySubscription = null;
          }
          useSetupStore
            .getState()
            .failDiscovery("Discovery failed unexpectedly.");
          track(ANALYTICS_EVENTS.SETUP_DISCOVERY_FAILED, {
            discovery_task_id: task.id,
            discovery_task_run_id: taskRun.id,
            reason: "failed",
            error_message:
              err instanceof Error ? err.message : "discovery_poll_error",
          });
          if (err instanceof Error) {
            captureException(err, { scope: "setup.discovery_poll" });
          }
        }
      });
    } catch (err) {
      if (abort.signal.aborted) return;
      log.error("Failed to start discovery", { error: err });
      const message =
        err instanceof Error ? err.message : "Failed to start discovery.";
      useSetupStore.getState().failDiscovery(message);
      track(ANALYTICS_EVENTS.SETUP_DISCOVERY_FAILED, {
        reason: "startup_error",
        error_message: message,
      });
      if (err instanceof Error) {
        captureException(err, { scope: "setup.start_discovery" });
      }
    } finally {
      if (this.discoveryAbort === abort) {
        this.discoveryAbort = null;
      }
    }
  }
}
