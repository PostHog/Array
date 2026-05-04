import { getAuthenticatedClient } from "@features/auth/hooks/authClient";
import { fetchAuthState } from "@features/auth/hooks/authQueries";
import { DISCOVERY_PROMPT } from "@features/setup/prompts";
import { useSetupStore } from "@features/setup/stores/setupStore";
import {
  type DiscoveredTask,
  TASK_DISCOVERY_JSON_SCHEMA,
} from "@features/setup/types";
import { trpcClient } from "@renderer/trpc/client";
import { isTerminalStatus, type Task } from "@shared/types";
import { ANALYTICS_EVENTS } from "@shared/types/analytics";
import { getCloudUrlFromRegion } from "@shared/utils/urls";
import { captureException, track } from "@utils/analytics";
import { logger } from "@utils/logger";
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

interface StaleFlagPayload {
  flagKey: string;
  references: { file: string; line: number; method: string }[];
  referenceCount: number;
}

function buildStaleFlagSuggestion(flag: StaleFlagPayload): DiscoveredTask {
  const refs = flag.references;
  const first = refs[0];
  const moreCount = Math.max(0, flag.referenceCount - refs.length);
  const referencesBlock = refs
    .map((r) => `- ${r.file}:${r.line} (${r.method})`)
    .join("\n");
  const recommendation = `Remove the flag check and inline the winning branch. Code references:\n${referencesBlock}${moreCount > 0 ? `\n…and ${moreCount} more.` : ""}`;
  return {
    // Stable id keyed off the flag key so dismissal sticks across re-runs.
    id: `posthog-stale-flag-${flag.flagKey}`,
    source: "enricher",
    category: "stale_feature_flag",
    title: `Clean up stale flag "${flag.flagKey}"`,
    description: `\`${flag.flagKey}\` hasn't been evaluated in 30+ days but is still referenced in ${flag.referenceCount} place${flag.referenceCount === 1 ? "" : "s"} in this codebase.`,
    impact:
      "Stale flags accumulate dead code paths and conditional branches that nobody is exercising any more — they make refactors riskier and obscure what's actually live in production.",
    recommendation,
    file: first?.file,
    lineHint: first?.line,
    prompt: `/cleaning-up-stale-feature-flags Clean up stale flag "${flag.flagKey}"\n\n${recommendation}`,
  };
}

function buildSdkHealthSuggestion(): DiscoveredTask {
  return {
    id: "posthog-sdk-health",
    source: "enricher",
    category: "posthog_setup",
    title: "Check PostHog SDK health",
    description:
      "Run a quick health check on the PostHog SDKs installed in this repo: confirm they're on supported versions, flag anything outdated or deprecated, and bump the safely-upgradable ones.",
    impact:
      "Outdated SDKs miss bug fixes, security patches, and new features (newer event types, recording APIs, flag evaluation behavior). Catching version drift early avoids surprise breakage when you eventually upgrade.",
    recommendation:
      'Click "Implement as new task" — the agent uses the bundled diagnosing-sdk-health skill to inspect each PostHog SDK\'s version, compare it against the latest, and open a PR with safe bumps. Breaking-change upgrades are flagged for your review rather than applied automatically.',
    prompt: "/diagnosing-sdk-health",
  };
}

function buildPosthogSetupSuggestion(
  state: "not_installed" | "installed_no_init",
): DiscoveredTask {
  if (state === "not_installed") {
    return {
      id: "posthog-setup",
      source: "enricher",
      category: "posthog_setup",
      title: "Set up PostHog",
      description:
        "PostHog isn't installed in this repo yet. Open this as a task to detect your framework, install the SDK, instrument analytics + error tracking + replay, and open a PR with the changes.",
      impact:
        "Without PostHog wired in, you have no visibility into how users interact with the product, no error or session-replay coverage, and no way to gate releases behind feature flags.",
      recommendation:
        'Click "Implement as new task" — the agent runs the bundled instrument-integration skill, sets up env vars, installs the SDK with your project\'s package manager, and opens a PR.',
      prompt: "/instrument-integration",
    };
  }
  return {
    id: "posthog-finish-init",
    source: "enricher",
    category: "posthog_setup",
    title: "Finish wiring PostHog",
    description:
      "The PostHog SDK is declared in this repo but `posthog.init(...)` (or the framework-equivalent provider) isn't called. Events won't be captured until that's wired up.",
    impact:
      "Until init runs, all PostHog calls are no-ops — you'll see no events in the project, no error reports, and no session replays despite the SDK being installed.",
    recommendation:
      'Click "Implement as new task" — the agent adds the init call and provider component for your framework, sets up the public-token + host env vars, and opens a PR. The SDK package itself is left alone.',
    prompt:
      "/instrument-integration\n\nThe SDK is already declared in this repo — skip install steps and focus on adding the init call, provider, and env vars.",
  };
}

@injectable()
export class SetupRunService {
  private discoveryStarting = false;
  private enricherSuggestionsRunning = false;

  startSetup(directory: string): void {
    this.injectEnricherSuggestions(directory);
    this.startDiscovery(directory);
  }

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

  injectEnricherSuggestions(directory: string): void {
    if (!directory) return;
    if (this.enricherSuggestionsRunning) return;
    this.enricherSuggestionsRunning = true;

    void (async () => {
      try {
        const installState =
          await trpcClient.enrichment.detectPosthogInstallState.query({
            repoPath: directory,
          });

        if (installState === "initialized") {
          useSetupStore
            .getState()
            .addEnricherSuggestionIfMissing(buildSdkHealthSuggestion());
          await this.injectStaleFlagSuggestions(directory);
        } else {
          const suggestion = buildPosthogSetupSuggestion(installState);
          useSetupStore.getState().addEnricherSuggestionIfMissing(suggestion);
        }
      } catch (err) {
        log.warn("Enricher run failed", { error: err });
      } finally {
        this.enricherSuggestionsRunning = false;
      }
    })();
  }

  private async injectStaleFlagSuggestions(directory: string): Promise<void> {
    try {
      const flags = await trpcClient.enrichment.findStaleFlagSuggestions.query({
        repoPath: directory,
      });
      const store = useSetupStore.getState();
      for (const flag of flags) {
        store.addEnricherSuggestionIfMissing(buildStaleFlagSuggestion(flag));
      }
    } catch (err) {
      log.warn("Failed to find stale flag suggestions", { error: err });
    }
  }

  private async runDiscovery(directory: string): Promise<void> {
    const state = useSetupStore.getState();
    if (
      state.discoveryStatus === "done" ||
      state.discoveryStatus === "running"
    ) {
      return;
    }

    const abort = new AbortController();
    const discoveryStartedAt = Date.now();

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

        const durationSeconds = Math.round(
          (Date.now() - discoveryStartedAt) / 1000,
        );

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
      const subscriptionAtAbort = subscription;
      abort.signal.addEventListener(
        "abort",
        () => {
          subscriptionAtAbort.unsubscribe();
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
    }
  }
}
