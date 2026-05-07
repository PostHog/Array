import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  type ModelInfo as AcpModelInfo,
  type AgentSideConnection,
  type ClientCapabilities,
  type ForkSessionRequest,
  type ForkSessionResponse,
  type InitializeRequest,
  type InitializeResponse,
  type ListSessionsRequest,
  type ListSessionsResponse,
  type LoadSessionRequest,
  type LoadSessionResponse,
  type NewSessionRequest,
  type NewSessionResponse,
  type PromptRequest,
  type PromptResponse,
  RequestError,
  type ResumeSessionRequest,
  type ResumeSessionResponse,
  type SessionConfigOption,
  type SessionConfigOptionCategory,
  type SessionConfigSelectOption,
  type SessionModelState,
  type SessionModeState,
  type SetSessionConfigOptionRequest,
  type SetSessionConfigOptionResponse,
  type SetSessionModelRequest,
  type SetSessionModelResponse,
  type SetSessionModeRequest,
  type SetSessionModeResponse,
  type Usage,
} from "@agentclientprotocol/sdk";
import {
  type CanUseTool,
  getSessionMessages,
  listSessions,
  type McpServerConfig,
  type Options,
  type Query,
  query,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { v7 as uuidv7 } from "uuid";
import packageJson from "../../../package.json" with { type: "json" };
import {
  isMethod,
  POSTHOG_METHODS,
  POSTHOG_NOTIFICATIONS,
} from "../../acp-extensions";
import {
  createEnrichment,
  type Enrichment,
  type FileEnrichmentDeps,
} from "../../enrichment/file-enricher";
import type { PostHogAPIConfig } from "../../types";
import { unreachable, withTimeout } from "../../utils/common";
import { Logger } from "../../utils/logger";
import { Pushable } from "../../utils/streams";
import { BaseAcpAgent } from "../base-acp-agent";
import { promptToClaude } from "./conversion/acp-to-sdk";
import {
  handleResultMessage,
  handleStreamEvent,
  handleSystemMessage,
  handleUserAssistantMessage,
} from "./conversion/sdk-to-acp";
import type { EnrichedReadCache } from "./hooks";
import {
  fetchMcpToolMetadata,
  getConnectedMcpServerNames,
  setMcpToolApprovalStates,
} from "./mcp/tool-metadata";
import { canUseTool } from "./permissions/permission-handlers";
import { getAvailableSlashCommands } from "./session/commands";
import { parseMcpServers } from "./session/mcp-config";
import {
  DEFAULT_MODEL,
  getEffortOptions,
  resolveModelPreference,
  supports1MContext,
  supportsMcpInjection,
  toSdkModelId,
} from "./session/models";
import {
  buildSessionOptions,
  buildSystemPrompt,
  type ProcessSpawnedInfo,
} from "./session/options";
import { SettingsManager } from "./session/settings";
import {
  CODE_EXECUTION_MODES,
  type CodeExecutionMode,
  getAvailableModes,
} from "./tools";
import type {
  BackgroundTerminal,
  EffortLevel,
  NewSessionMeta,
  SDKMessageFilter,
  Session,
  ToolUseCache,
  ToolUseStreamCache,
} from "./types";

const SESSION_VALIDATION_TIMEOUT_MS = 30_000;
const MAX_TITLE_LENGTH = 256;
const LOCAL_ONLY_COMMANDS = new Set(["/context", "/heapdump", "/extra-usage"]);

function sanitizeTitle(text: string): string {
  const sanitized = text
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (sanitized.length <= MAX_TITLE_LENGTH) {
    return sanitized;
  }
  return `${sanitized.slice(0, MAX_TITLE_LENGTH - 1)}…`;
}

function shouldEmitRawMessage(
  config: boolean | SDKMessageFilter[],
  message: { type: string; subtype?: string },
): boolean {
  if (config === true) return true;
  if (config === false) return false;
  return config.some(
    (f) =>
      f.type === message.type &&
      (f.subtype === undefined || f.subtype === message.subtype),
  );
}

export interface ClaudeAcpAgentOptions {
  onProcessSpawned?: (info: ProcessSpawnedInfo) => void;
  onProcessExited?: (pid: number) => void;
  onMcpServersReady?: (serverNames: string[]) => void;
  onStructuredOutput?: (output: Record<string, unknown>) => Promise<void>;
  posthogApiConfig?: PostHogAPIConfig;
}

export class ClaudeAcpAgent extends BaseAcpAgent {
  readonly adapterName = "claude";
  declare session: Session;
  toolUseCache: ToolUseCache;
  toolUseStreamCache: ToolUseStreamCache;
  backgroundTerminals: { [key: string]: BackgroundTerminal } = {};
  clientCapabilities?: ClientCapabilities;
  private options?: ClaudeAcpAgentOptions;
  private enrichment?: Enrichment;
  private enrichedReadCache: EnrichedReadCache = new Map();

  constructor(client: AgentSideConnection, options?: ClaudeAcpAgentOptions) {
    super(client);
    this.options = options;
    this.toolUseCache = {};
    this.toolUseStreamCache = new Map();
    this.logger = new Logger({ debug: true, prefix: "[ClaudeAcpAgent]" });
    this.enrichment = createEnrichment(options?.posthogApiConfig, this.logger);
  }

  protected getEnrichmentDeps(): FileEnrichmentDeps | undefined {
    return this.enrichment?.deps;
  }

  override async closeSession(): Promise<void> {
    try {
      await super.closeSession();
    } finally {
      this.enrichment?.dispose();
      this.enrichment = undefined;
      this.enrichedReadCache.clear();
    }
  }

  async initialize(request: InitializeRequest): Promise<InitializeResponse> {
    this.clientCapabilities = request.clientCapabilities;

    return {
      protocolVersion: 1,
      agentCapabilities: {
        promptCapabilities: {
          image: true,
          embeddedContext: true,
        },
        mcpCapabilities: {
          http: true,
          sse: true,
        },
        loadSession: true,
        sessionCapabilities: {
          list: {},
          fork: {},
          resume: {},
        },
        _meta: {
          posthog: {
            resumeSession: true,
          },
          claudeCode: {
            promptQueueing: true,
          },
        },
      },
      agentInfo: {
        name: packageJson.name,
        title: "Claude Agent",
        version: packageJson.version,
      },
      authMethods: [],
    };
  }

  async newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
    // Upstream Claude Code renames .claude.json to .claude.json.backup on logout.
    // If the backup exists but the original doesn't, the user is logged out.
    if (
      fs.existsSync(path.resolve(os.homedir(), ".claude.json.backup")) &&
      !fs.existsSync(path.resolve(os.homedir(), ".claude.json"))
    ) {
      throw RequestError.authRequired();
    }

    const response = await this.createSession(params, {
      // Revisit these meta values once we support resume
      resume: (params._meta as NewSessionMeta | undefined)?.claudeCode?.options
        ?.resume as string | undefined,
    });

    return response;
  }

  async unstable_forkSession(
    params: ForkSessionRequest,
  ): Promise<ForkSessionResponse> {
    return this.createSession(
      {
        cwd: params.cwd,
        mcpServers: params.mcpServers ?? [],
        _meta: params._meta,
      },
      { resume: params.sessionId, forkSession: true },
    );
  }

  async unstable_resumeSession(
    params: ResumeSessionRequest,
  ): Promise<ResumeSessionResponse> {
    // Reuse existing session if it matches
    const existing = this.getExistingSessionState(params.sessionId);
    if (existing) return existing;

    const response = await this.createSession(
      {
        cwd: params.cwd,
        mcpServers: params.mcpServers ?? [],
        _meta: params._meta,
      },
      {
        resume: params.sessionId,
      },
    );

    return response;
  }

  async loadSession(params: LoadSessionRequest): Promise<LoadSessionResponse> {
    // Reuse existing session if it matches
    const existing = this.getExistingSessionState(params.sessionId);
    if (existing) return existing;

    const response = await this.createSession(
      {
        cwd: params.cwd,
        mcpServers: params.mcpServers ?? [],
        _meta: params._meta,
      },
      { resume: params.sessionId, skipBackgroundFetches: true },
    );

    await this.replaySessionHistory(params.sessionId);

    // Send available commands after replay so they don't interleave with history
    this.deferBackgroundFetches(this.session.query);

    return {
      modes: response.modes,
      models: response.models,
      configOptions: response.configOptions,
    };
  }

  async listSessions(
    params: ListSessionsRequest,
  ): Promise<ListSessionsResponse> {
    const sdkSessions = await listSessions({ dir: params.cwd ?? undefined });
    const sessions = [];

    for (const session of sdkSessions) {
      if (!session.cwd) continue;
      sessions.push({
        sessionId: session.sessionId,
        cwd: session.cwd,
        title: sanitizeTitle(session.customTitle || session.summary || ""),
        updatedAt: new Date(session.lastModified).toISOString(),
      });
    }
    return {
      sessions,
    };
  }

  async unstable_listSessions(
    params: ListSessionsRequest,
  ): Promise<ListSessionsResponse> {
    return this.listSessions(params);
  }

  async prompt(params: PromptRequest): Promise<PromptResponse> {
    const userMessage = promptToClaude(params);
    const promptUuid = randomUUID();
    userMessage.uuid = promptUuid;
    let promptReplayed = false;
    let isLocalOnlyCommand = false;

    // Detect local-only slash commands that return results without model invocation
    const msgContent = userMessage.message.content;
    let firstTextPart = "";
    if (typeof msgContent === "string") {
      firstTextPart = msgContent;
    } else if (Array.isArray(msgContent)) {
      for (const block of msgContent) {
        if ("type" in block && block.type === "text" && "text" in block) {
          firstTextPart = block.text as string;
          break;
        }
      }
    }
    const commandMatch = firstTextPart.match(/^(\/\S+)/);
    if (commandMatch && LOCAL_ONLY_COMMANDS.has(commandMatch[1])) {
      isLocalOnlyCommand = true;
      promptReplayed = true;
    }

    if (this.session.promptRunning) {
      this.session.input.push(userMessage);
      const order = this.session.nextPendingOrder++;
      const cancelled = await new Promise<boolean>((resolve) => {
        this.session.pendingMessages.set(promptUuid, { resolve, order });
      });
      if (cancelled) {
        return { stopReason: "cancelled" };
      }
      promptReplayed = true;
    } else {
      this.session.input.push(userMessage);
    }

    // Reset session state here (after the queued-wait) rather than at the
    // top of prompt(). Otherwise a new prompt() call would wipe cancelled=true
    // on the previous still-running loop, causing it to return end_turn
    // instead of the cancelled stop reason the spec requires.
    this.session.cancelled = false;
    this.session.interruptReason = undefined;
    this.session.accumulatedUsage = {
      inputTokens: 0,
      outputTokens: 0,
      cachedReadTokens: 0,
      cachedWriteTokens: 0,
    };

    await this.broadcastUserMessage(params);

    this.session.promptRunning = true;
    let handedOff = false;
    let lastAssistantTotalUsage: number | null = null;
    let lastStreamUsage = {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    };
    if (this.session.lastContextWindowSize == null) {
      this.session.lastContextWindowSize = this.getContextWindowForModel(
        this.session.modelId ?? "",
      );
      this.logger.debug("Initial context window size from gateway", {
        modelId: this.session.modelId,
        contextWindowSize: this.session.lastContextWindowSize,
      });
    }
    let lastContextWindowSize = this.session.lastContextWindowSize;

    const supportsTerminalOutput =
      (
        this.clientCapabilities?._meta as
          | ClientCapabilities["_meta"]
          | undefined
      )?.terminal_output === true;

    const context = {
      session: this.session,
      sessionId: params.sessionId,
      client: this.client,
      toolUseCache: this.toolUseCache,
      toolUseStreamCache: this.toolUseStreamCache,
      fileContentCache: this.fileContentCache,
      enrichedReadCache: this.enrichedReadCache,
      logger: this.logger,
      supportsTerminalOutput,
    };

    try {
      while (true) {
        const { value: message, done } = await this.session.query.next();

        if (done || !message) {
          if (this.session.cancelled) {
            return {
              stopReason: "cancelled",
              _meta: this.session.interruptReason
                ? { interruptReason: this.session.interruptReason }
                : undefined,
            };
          }
          break;
        }

        if (
          this.session.emitRawSDKMessages &&
          shouldEmitRawMessage(this.session.emitRawSDKMessages, message)
        ) {
          await this.client.extNotification("_claude/sdkMessage", {
            sessionId: params.sessionId,
            message: message as Record<string, unknown>,
          });
        }

        switch (message.type) {
          case "system":
            if (message.subtype === "compact_boundary") {
              // Send used:0 immediately so the client doesn't keep showing
              // the stale pre-compaction context size until the next turn.
              lastAssistantTotalUsage = 0;
              promptReplayed = true;
              await this.client.sessionUpdate({
                sessionId: params.sessionId,
                update: {
                  sessionUpdate: "usage_update",
                  used: 0,
                  size: lastContextWindowSize,
                },
              });
            }
            if (message.subtype === "local_command_output") {
              promptReplayed = true;
            }
            if (
              message.subtype === "session_state_changed" &&
              (message as Record<string, unknown>).state === "idle"
            ) {
              if (!promptReplayed) {
                this.logger.debug("Skipping idle state before prompt replay", {
                  sessionId: params.sessionId,
                });
                break;
              }

              const acc = this.session.accumulatedUsage;
              const totalUsed =
                acc.inputTokens +
                acc.outputTokens +
                acc.cachedReadTokens +
                acc.cachedWriteTokens;

              await this.client.sessionUpdate({
                sessionId: params.sessionId,
                update: {
                  sessionUpdate: "usage_update",
                  used: totalUsed,
                  size: lastContextWindowSize,
                },
              });

              return { stopReason: "end_turn" };
            }
            await handleSystemMessage(message, context);
            break;

          case "result": {
            // Skip results from background tasks that finished after our prompt started
            if (!promptReplayed) {
              this.logger.debug(
                "Skipping background task result before prompt replay",
                { sessionId: params.sessionId },
              );
              break;
            }

            if (this.session.cancelled) {
              return { stopReason: "cancelled" };
            }

            // Accumulate usage from this result (guard against null from SDK)
            this.session.accumulatedUsage.inputTokens +=
              message.usage.input_tokens ?? 0;
            this.session.accumulatedUsage.outputTokens +=
              message.usage.output_tokens ?? 0;
            this.session.accumulatedUsage.cachedReadTokens +=
              message.usage.cache_read_input_tokens ?? 0;
            this.session.accumulatedUsage.cachedWriteTokens +=
              message.usage.cache_creation_input_tokens ?? 0;

            // SDK can underreport context window (e.g. 200k for 1M models).
            // Use SDK value only if it's larger than what gateway reported.
            const contextWindows = Object.values(message.modelUsage).map(
              (m) => m.contextWindow,
            );
            if (contextWindows.length > 0) {
              const sdkContextWindow = Math.min(...contextWindows);
              if (sdkContextWindow > lastContextWindowSize) {
                lastContextWindowSize = sdkContextWindow;
              }
            }
            this.session.lastContextWindowSize = lastContextWindowSize;

            this.session.contextSize = lastContextWindowSize;
            if (lastAssistantTotalUsage !== null) {
              this.session.contextUsed = lastAssistantTotalUsage;
            }

            // Send usage_update notification
            if (lastAssistantTotalUsage !== null) {
              await this.client.sessionUpdate({
                sessionId: params.sessionId,
                update: {
                  sessionUpdate: "usage_update",
                  used: lastAssistantTotalUsage,
                  size: lastContextWindowSize,
                  cost: {
                    amount: message.total_cost_usd,
                    currency: "USD",
                  },
                },
              });
            }

            await this.client.extNotification(
              POSTHOG_NOTIFICATIONS.USAGE_UPDATE,
              {
                sessionId: params.sessionId,
                used: {
                  inputTokens: message.usage.input_tokens,
                  outputTokens: message.usage.output_tokens,
                  cachedReadTokens: message.usage.cache_read_input_tokens,
                  cachedWriteTokens: message.usage.cache_creation_input_tokens,
                },
                cost: message.total_cost_usd,
              },
            );

            const usage: Usage = {
              inputTokens: this.session.accumulatedUsage.inputTokens,
              outputTokens: this.session.accumulatedUsage.outputTokens,
              cachedReadTokens: this.session.accumulatedUsage.cachedReadTokens,
              cachedWriteTokens:
                this.session.accumulatedUsage.cachedWriteTokens,
              totalTokens:
                this.session.accumulatedUsage.inputTokens +
                this.session.accumulatedUsage.outputTokens +
                this.session.accumulatedUsage.cachedReadTokens +
                this.session.accumulatedUsage.cachedWriteTokens,
            };

            const result = handleResultMessage(message);
            if (result.error) throw result.error;

            // Deliver structured output from SDK's native outputFormat
            if (
              message.subtype === "success" &&
              message.structured_output != null &&
              this.options?.onStructuredOutput
            ) {
              await this.options.onStructuredOutput(
                message.structured_output as Record<string, unknown>,
              );
            }

            // For local-only commands, forward the result text to the client
            if (
              isLocalOnlyCommand &&
              message.subtype === "success" &&
              message.result
            ) {
              await this.client.sessionUpdate({
                sessionId: params.sessionId,
                update: {
                  sessionUpdate: "agent_message_chunk",
                  content: { type: "text", text: message.result },
                },
              });
            }

            return { stopReason: result.stopReason ?? "end_turn", usage };
          }

          case "stream_event": {
            if (
              message.parent_tool_use_id === null &&
              (message.event.type === "message_start" ||
                message.event.type === "message_delta")
            ) {
              if (message.event.type === "message_start") {
                const u = message.event.message.usage;
                lastStreamUsage = {
                  input_tokens: u.input_tokens ?? 0,
                  output_tokens: u.output_tokens ?? 0,
                  cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
                  cache_creation_input_tokens:
                    u.cache_creation_input_tokens ?? 0,
                };
              } else {
                const u = message.event.usage;
                lastStreamUsage = {
                  input_tokens: u.input_tokens ?? lastStreamUsage.input_tokens,
                  output_tokens: u.output_tokens,
                  cache_read_input_tokens:
                    u.cache_read_input_tokens ??
                    lastStreamUsage.cache_read_input_tokens,
                  cache_creation_input_tokens:
                    u.cache_creation_input_tokens ??
                    lastStreamUsage.cache_creation_input_tokens,
                };
              }

              const nextTotal =
                lastStreamUsage.input_tokens +
                lastStreamUsage.output_tokens +
                lastStreamUsage.cache_read_input_tokens +
                lastStreamUsage.cache_creation_input_tokens;

              if (nextTotal !== lastAssistantTotalUsage) {
                lastAssistantTotalUsage = nextTotal;
                await this.client.sessionUpdate({
                  sessionId: params.sessionId,
                  update: {
                    sessionUpdate: "usage_update",
                    used: nextTotal,
                    size: lastContextWindowSize,
                  },
                });
              }
            }
            await handleStreamEvent(message, context);
            break;
          }

          case "user":
          case "assistant": {
            // Check for prompt replay (our own message echoed back)
            if (message.type === "user" && "uuid" in message && message.uuid) {
              if (message.uuid === promptUuid) {
                promptReplayed = true;
                break;
              }

              const pending = this.session.pendingMessages.get(
                message.uuid as string,
              );
              if (pending) {
                pending.resolve(false);
                this.session.pendingMessages.delete(message.uuid as string);
                handedOff = true;
                return {
                  stopReason: this.session.cancelled ? "cancelled" : "end_turn",
                };
              }
            }

            if (this.session.cancelled) {
              break;
            }

            // Skip replayed user messages that aren't pending prompts
            if (
              "isReplay" in message &&
              (message as Record<string, unknown>).isReplay
            ) {
              break;
            }

            // Store latest assistant usage (excluding subagents)
            // Sum all token types as a proxy for post-turn context occupancy:
            // current turn's output will become next turn's input.
            // Note: per the Anthropic API, input_tokens excludes cache tokens —
            // cache_read and cache_creation are reported separately, so summing
            // all four fields is not double-counting.
            if (
              "usage" in message.message &&
              message.parent_tool_use_id === null
            ) {
              const usage = (
                message.message as unknown as Record<string, unknown>
              ).usage as {
                input_tokens: number | null;
                output_tokens: number | null;
                cache_read_input_tokens: number | null;
                cache_creation_input_tokens: number | null;
              };
              lastAssistantTotalUsage =
                (usage.input_tokens ?? 0) +
                (usage.output_tokens ?? 0) +
                (usage.cache_read_input_tokens ?? 0) +
                (usage.cache_creation_input_tokens ?? 0);

              await this.client.sessionUpdate({
                sessionId: params.sessionId,
                update: {
                  sessionUpdate: "usage_update",
                  used: lastAssistantTotalUsage,
                  size: lastContextWindowSize,
                  cost: null,
                },
              });
            }

            const result = await handleUserAssistantMessage(message, context);
            if (result.error) throw result.error;
            if (result.shouldStop) {
              return { stopReason: "end_turn" };
            }
            break;
          }

          case "tool_progress":
          case "auth_status":
          case "tool_use_summary":
          case "prompt_suggestion":
          case "rate_limit_event":
            break;

          default:
            unreachable(message as never, this.logger);
            break;
        }
      }
      throw new Error("Session did not end in result");
    } catch (error) {
      if (error instanceof RequestError || !(error instanceof Error)) {
        throw error;
      }
      const msg = error.message;
      if (
        msg.includes("ProcessTransport") ||
        msg.includes("terminated process") ||
        msg.includes("process exited with") ||
        msg.includes("process terminated by signal") ||
        msg.includes("Failed to write to process stdin")
      ) {
        this.logger.error(`Process died: ${msg}`, {
          sessionId: this.sessionId,
        });
        this.session.settingsManager.dispose();
        this.session.input.end();
        throw RequestError.internalError(
          undefined,
          "The Claude Agent process exited unexpectedly. Please start a new session.",
        );
      }
      throw error;
    } finally {
      // Drop any leftover streaming-input buffers. Normally cleared per index
      // on `content_block_stop`, but a cancelled or errored turn may leave
      // entries behind; without this they'd carry over into the next turn
      // and collide with new content-block indices.
      this.toolUseStreamCache.clear();
      if (!handedOff) {
        this.session.promptRunning = false;
        // Resolve all remaining pending prompts so no callers get stuck.
        for (const [key, pending] of this.session.pendingMessages) {
          pending.resolve(true);
          this.session.pendingMessages.delete(key);
        }
      }
    }
  }

  // Called by BaseAcpAgent#cancel() to interrupt the session
  protected async interrupt(): Promise<void> {
    this.session.cancelled = true;
    for (const [, pending] of this.session.pendingMessages) {
      pending.resolve(true);
    }
    this.session.pendingMessages.clear();
    await this.session.query.interrupt();
  }

  /**
   * Refresh the session between turns. Currently the only refreshable field
   * is `mcpServers` — a resume-with-new-options reinit that bakes the servers
   * into query() options (preserving conversation history via resume).
   *
   * This is an `extMethod` (request/response), not `extNotification`, so the
   * caller can await completion before sending the next prompt. The sandbox
   * agent-server uses this on pre-prompt TTL checks.
   *
   * Why resume+rebuild instead of query.setMcpServers()?
   * setMcpServers() does NOT always overwrite servers installed by local/plugin
   * config — it can non-deterministically surface either the config-provided
   * server or the plugin-installed one. In the sandbox, repos may have Claude
   * plugins with their own MCPs, and we want the CLI-supplied set to fully win.
   * Passing mcpServers via query() options (as a "managed"/static set) has that
   * overwrite guarantee, so we tear down the current Query and construct a new
   * one with resume.
   *
   * Caller contract: only call REFRESH_SESSION between turns (no prompt in flight).
   */
  async extMethod(
    method: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (!isMethod(method, POSTHOG_METHODS.REFRESH_SESSION)) {
      throw RequestError.methodNotFound(method);
    }

    // Trust boundary: refresh is only safe when the caller is trusted infra
    // (e.g. the sandbox agent-server). Do not route this method from
    // untrusted clients — parseMcpServers does no URL/command validation.
    if (params.mcpServers === undefined) {
      throw new RequestError(
        -32602,
        "refresh_session requires at least one refreshable field (e.g. mcpServers)",
      );
    }
    if (!Array.isArray(params.mcpServers)) {
      throw new RequestError(
        -32602,
        "refresh_session: mcpServers must be an array",
      );
    }

    const mcpServers = parseMcpServers(
      params as Pick<NewSessionRequest, "mcpServers">,
    );
    await this.refreshSession(mcpServers);
    return { refreshed: true };
  }

  private async refreshSession(
    mcpServers: Record<string, McpServerConfig>,
  ): Promise<void> {
    const prev = this.session;
    if (prev.promptRunning) {
      throw new RequestError(
        -32002,
        "Cannot refresh session while a prompt turn is in flight",
      );
    }
    if (prev.modelId && !supportsMcpInjection(prev.modelId)) {
      throw new RequestError(
        -32002,
        `Model ${prev.modelId} does not support MCP injection; cannot refresh`,
      );
    }

    this.logger.info("Refreshing session with fresh MCP servers", {
      serverCount: Object.keys(mcpServers).length,
      sessionId: this.sessionId,
    });

    // Abort FIRST so any stuck in-flight HTTP request unblocks — otherwise
    // interrupt() can deadlock waiting on an API call that never returns.
    // We allocate a fresh controller for the new Query below so aborting
    // the old one doesn't poison it.
    prev.abortController.abort();
    await prev.query.interrupt();
    prev.input.end();

    // Reuse every option from the running session; swap mcpServers, re-root
    // identity on `resume` instead of `sessionId`, and give the new Query a
    // fresh AbortController.
    const newAbortController = new AbortController();
    const { sessionId: _drop, ...rest } = prev.queryOptions;
    const newOptions: Options = {
      ...rest,
      mcpServers,
      resume: this.sessionId,
      forkSession: false,
      abortController: newAbortController,
    };

    const newInput = new Pushable<SDKUserMessage>();
    const newQuery = query({ prompt: newInput, options: newOptions });

    prev.query = newQuery;
    prev.input = newInput;
    prev.queryOptions = newOptions;
    prev.abortController = newAbortController;

    const result = await withTimeout(
      newQuery.initializationResult(),
      SESSION_VALIDATION_TIMEOUT_MS,
    );
    if (result.result === "timeout") {
      throw new Error(`Session refresh timed out for ${this.sessionId}`);
    }

    // Re-fetch MCP tool metadata + slash commands — the server list changed.
    this.deferBackgroundFetches(newQuery);
  }

  async unstable_setSessionModel(
    params: SetSessionModelRequest,
  ): Promise<SetSessionModelResponse | undefined> {
    await this.session.query.setModel(toSdkModelId(params.modelId));
    this.session.modelId = params.modelId;
    this.session.lastContextWindowSize = this.getContextWindowForModel(
      params.modelId,
    );
    this.rebuildEffortConfigOption(params.modelId);
    await this.updateConfigOption("model", params.modelId);
    return {};
  }

  async setSessionMode(
    params: SetSessionModeRequest,
  ): Promise<SetSessionModeResponse> {
    await this.applySessionMode(params.modeId);
    await this.updateConfigOption("mode", params.modeId);
    return {};
  }

  async setSessionConfigOption(
    params: SetSessionConfigOptionRequest,
  ): Promise<SetSessionConfigOptionResponse> {
    const option = this.session.configOptions.find(
      (o) => o.id === params.configId,
    );
    if (!option) {
      throw new Error(`Unknown config option: ${params.configId}`);
    }

    if (typeof params.value !== "string") {
      throw new Error(
        `Invalid value type for config option ${params.configId}`,
      );
    }

    const allValues: { value: string; name?: string; description?: string }[] =
      "options" in option && Array.isArray(option.options)
        ? (option.options as Array<Record<string, unknown>>).flatMap((o) =>
            "options" in o && Array.isArray(o.options)
              ? (o.options as {
                  value: string;
                  name?: string;
                  description?: string;
                }[])
              : [o as { value: string; name?: string; description?: string }],
          )
        : [];
    let validValue = allValues.find((o) => o.value === params.value);

    // For model options, fall back to alias resolution when exact match fails.
    // This lets callers use human-friendly aliases like "opus" or "sonnet"
    // instead of full model IDs like "claude-opus-4-6".
    if (!validValue && params.configId === "model") {
      const resolved = resolveModelPreference(params.value, allValues);
      if (resolved) {
        validValue = allValues.find((o) => o.value === resolved);
      }
    }

    if (!validValue) {
      throw new Error(
        `Invalid value for config option ${params.configId}: ${params.value}`,
      );
    }

    // Use the canonical option value so downstream code always receives the
    // model ID rather than the caller-supplied alias.
    const resolvedValue = validValue.value;

    if (params.configId === "mode") {
      await this.applySessionMode(resolvedValue);
      await this.client.sessionUpdate({
        sessionId: this.sessionId,
        update: {
          sessionUpdate: "current_mode_update",
          currentModeId: resolvedValue,
        },
      });
    } else if (params.configId === "model") {
      const sdkModelId = toSdkModelId(resolvedValue);
      await this.session.query.setModel(sdkModelId);
      this.session.modelId = resolvedValue;
      this.session.lastContextWindowSize =
        this.getContextWindowForModel(resolvedValue);
      this.rebuildEffortConfigOption(resolvedValue);
    } else if (params.configId === "effort") {
      const newEffort = resolvedValue as EffortLevel;
      this.session.effort = newEffort;
      this.session.queryOptions.effort = newEffort;
      await this.session.query.applyFlagSettings({
        // @ts-expect-error SDK Settings.effortLevel omits "max" but runtime accepts it
        effortLevel: newEffort,
      });
    }

    this.session.configOptions = this.session.configOptions.map((o) =>
      o.id === params.configId && typeof o.currentValue === "string"
        ? { ...o, currentValue: resolvedValue }
        : o,
    );

    return { configOptions: this.session.configOptions };
  }

  private async updateConfigOption(
    configId: string,
    value: string,
  ): Promise<void> {
    this.session.configOptions = this.session.configOptions.map((o) =>
      o.id === configId && typeof o.currentValue === "string"
        ? { ...o, currentValue: value }
        : o,
    );

    await this.client.sessionUpdate({
      sessionId: this.sessionId,
      update: {
        sessionUpdate: "config_option_update",
        configOptions: this.session.configOptions,
      },
    });

    // Notify the agent-server so its cached permissionMode stays in sync.
    // Without this, cloud sessions that change mode via plan approval or
    // setSessionMode use a stale mode for relay decisions.
    if (configId === "mode") {
      await this.client.sessionUpdate({
        sessionId: this.sessionId,
        update: {
          sessionUpdate: "current_mode_update",
          currentModeId: value,
        },
      });
    }
  }

  private async applySessionMode(modeId: string): Promise<void> {
    if (!CODE_EXECUTION_MODES.includes(modeId as CodeExecutionMode)) {
      throw new Error("Invalid Mode");
    }
    const previousMode = this.session.permissionMode;
    this.session.permissionMode = modeId as CodeExecutionMode;
    if (modeId === "plan" && previousMode !== "plan") {
      this.session.modeBeforePlan = previousMode;
    }
    try {
      await this.session.query.setPermissionMode(modeId as CodeExecutionMode);
    } catch (error) {
      this.session.permissionMode = previousMode;
      if (error instanceof Error) {
        if (!error.message) {
          error.message = "Invalid Mode";
        }
        throw error;
      }
      throw new Error("Invalid Mode");
    }
  }

  private async createSession(
    params: {
      cwd: string;
      mcpServers: NewSessionRequest["mcpServers"];
      _meta?: unknown;
    },
    creationOpts: {
      resume?: string;
      forkSession?: boolean;
      skipBackgroundFetches?: boolean;
    } = {},
  ): Promise<NewSessionResponse> {
    const { cwd } = params;
    const { resume, forkSession } = creationOpts;

    const isResume = !!resume;

    const meta = params._meta as NewSessionMeta | undefined;
    const taskId = meta?.persistence?.taskId;
    const effort = meta?.claudeCode?.options?.effort as EffortLevel | undefined;

    // We want to create a new session id unless it is resume,
    // but not resume + forkSession.
    let sessionId: string;
    if (forkSession) {
      sessionId = uuidv7();
    } else if (isResume) {
      sessionId = resume;
    } else {
      sessionId = uuidv7();
    }

    const input = new Pushable<SDKUserMessage>();

    const settingsManager = new SettingsManager(cwd);
    await settingsManager.initialize();

    const earlyModelId =
      settingsManager.getSettings().model || meta?.model || "";
    const mcpServers = supportsMcpInjection(earlyModelId)
      ? parseMcpServers(params)
      : {};
    const systemPrompt = buildSystemPrompt(meta?.systemPrompt);

    if (meta?.mcpToolApprovals) {
      setMcpToolApprovalStates(meta.mcpToolApprovals);
    }

    // Configure structured output via SDK's native outputFormat
    const outputFormat =
      meta?.jsonSchema && this.options?.onStructuredOutput
        ? { type: "json_schema" as const, schema: meta.jsonSchema }
        : undefined;

    this.logger.debug(isResume ? "Resuming session" : "Creating new session", {
      sessionId,
      taskId,
      taskRunId: meta?.taskRunId,
      cwd,
    });

    const permissionMode: CodeExecutionMode =
      meta?.permissionMode &&
      CODE_EXECUTION_MODES.includes(meta.permissionMode as CodeExecutionMode)
        ? (meta.permissionMode as CodeExecutionMode)
        : "default";

    const options = buildSessionOptions({
      cwd,
      mcpServers,
      permissionMode,
      canUseTool: this.createCanUseTool(sessionId, meta?.allowedDomains),
      logger: this.logger,
      systemPrompt,
      userProvidedOptions: meta?.claudeCode?.options,
      sessionId,
      isResume,
      forkSession,
      additionalDirectories: [
        ...(meta?.claudeCode?.options?.additionalDirectories ?? []),
        ...(meta?.additionalRoots ?? []),
      ],
      disableBuiltInTools: meta?.disableBuiltInTools,
      outputFormat,
      settingsManager,
      onModeChange: this.createOnModeChange(),
      onProcessSpawned: this.options?.onProcessSpawned,
      onProcessExited: this.options?.onProcessExited,
      effort,
      enrichmentDeps: this.enrichment?.deps,
      enrichedReadCache: this.enrichedReadCache,
    });

    // Use the same abort controller that buildSessionOptions gave to the query
    const abortController = options.abortController as AbortController;

    const q = query({ prompt: input, options });

    const session: Session = {
      query: q,
      queryOptions: options,
      input,
      cancelled: false,
      settingsManager,
      permissionMode,
      abortController,
      accumulatedUsage: {
        inputTokens: 0,
        outputTokens: 0,
        cachedReadTokens: 0,
        cachedWriteTokens: 0,
      },
      effort,
      configOptions: [],
      promptRunning: false,
      pendingMessages: new Map(),
      nextPendingOrder: 0,
      emitRawSDKMessages: meta?.claudeCode?.emitRawSDKMessages ?? false,

      // Custom properties
      cwd,
      notificationHistory: [],
      taskRunId: meta?.taskRunId,
    };
    this.session = session;
    this.sessionId = sessionId;

    if (isResume) {
      // Resume must block on initialization to validate the session is still alive.
      // For stale sessions this throws (e.g. "No conversation found").
      try {
        const result = await withTimeout(
          q.initializationResult(),
          SESSION_VALIDATION_TIMEOUT_MS,
        );
        if (result.result === "timeout") {
          throw new Error(
            `Session ${forkSession ? "fork" : "resumption"} timed out for sessionId=${sessionId}`,
          );
        }
      } catch (err) {
        settingsManager.dispose();
        if (
          err instanceof Error &&
          err.message === "Query closed before response received"
        ) {
          throw RequestError.resourceNotFound(sessionId);
        }
        this.logger.error(
          forkSession ? "Session fork failed" : "Session resumption failed",
          {
            sessionId,
            taskId,
            taskRunId: meta?.taskRunId,
            error: err instanceof Error ? err.message : String(err),
          },
        );
        throw err;
      }
    }

    // Kick off SDK initialization for new sessions so it runs concurrently
    // with the model config fetch below (the gateway REST call is independent).
    const initPromise = !isResume
      ? withTimeout(q.initializationResult(), SESSION_VALIDATION_TIMEOUT_MS)
      : undefined;

    const [modelOptions] = await Promise.all([
      this.getModelConfigOptions(
        settingsManager.getSettings().model || meta?.model || undefined,
      ),
      ...(meta?.taskRunId
        ? [
            this.client.extNotification(POSTHOG_NOTIFICATIONS.SDK_SESSION, {
              taskRunId: meta.taskRunId,
              sessionId,
              adapter: "claude",
            }),
          ]
        : []),
    ]);

    if (initPromise) {
      try {
        const initResult = await initPromise;
        if (initResult.result === "timeout") {
          settingsManager.dispose();
          throw new Error(
            `Session initialization timed out for sessionId=${sessionId}`,
          );
        }
      } catch (err) {
        settingsManager.dispose();
        this.logger.error("Session initialization failed", {
          sessionId,
          taskId,
          taskRunId: meta?.taskRunId,
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
    }

    const settingsModel = settingsManager.getSettings().model;
    const metaModel = meta?.model;
    const resolvedModelId =
      settingsModel || metaModel || modelOptions.currentModelId;
    session.modelId = resolvedModelId;
    session.lastContextWindowSize =
      this.getContextWindowForModel(resolvedModelId);

    const resolvedSdkModel = toSdkModelId(resolvedModelId);

    if (!isResume && resolvedSdkModel !== DEFAULT_MODEL) {
      await this.session.query.setModel(resolvedSdkModel);
    }

    if (supports1MContext(resolvedModelId)) {
      options.betas = ["context-1m-2025-08-07"];
    }

    const availableModes = getAvailableModes();
    const modes: SessionModeState = {
      currentModeId: permissionMode,
      availableModes: availableModes.map((mode) => ({
        id: mode.id,
        name: mode.name,
        description: mode.description ?? undefined,
      })),
    };

    const models: SessionModelState = {
      currentModelId: resolvedModelId,
      availableModels: modelOptions.options.map(
        (opt): AcpModelInfo => ({
          modelId: opt.value,
          name: opt.name,
          description: opt.description,
        }),
      ),
    };

    const configOptions = this.buildConfigOptions(
      permissionMode,
      modelOptions,
      effort ?? "medium",
    );
    session.configOptions = configOptions;

    if (!creationOpts.skipBackgroundFetches) {
      this.deferBackgroundFetches(q);
    }

    return { sessionId, modes, models, configOptions };
  }

  private createCanUseTool(
    sessionId: string,
    allowedDomains?: string[],
  ): CanUseTool {
    return async (toolName, toolInput, { suggestions, toolUseID, signal }) =>
      canUseTool({
        session: this.session,
        toolName,
        toolInput: toolInput as Record<string, unknown>,
        toolUseID,
        suggestions,
        signal,
        client: this.client,
        sessionId,
        fileContentCache: this.fileContentCache,
        logger: this.logger,
        updateConfigOption: (configId: string, value: string) =>
          this.updateConfigOption(configId, value),
        applySessionMode: (modeId: string) => this.applySessionMode(modeId),
        allowedDomains,
      });
  }

  private createOnModeChange() {
    return async (newMode: CodeExecutionMode) => {
      if (this.session) {
        const previousMode = this.session.permissionMode;
        this.session.permissionMode = newMode;
        if (newMode === "plan" && previousMode !== "plan") {
          this.session.modeBeforePlan = previousMode;
        }
      }
      await this.updateConfigOption("mode", newMode);
    };
  }

  private getExistingSessionState(
    sessionId: string,
  ): NewSessionResponse | null {
    if (this.sessionId !== sessionId || !this.session) return null;

    const availableModes = getAvailableModes();
    const modes: SessionModeState = {
      currentModeId: this.session.permissionMode,
      availableModes: availableModes.map((mode) => ({
        id: mode.id,
        name: mode.name,
        description: mode.description ?? undefined,
      })),
    };

    const modelOptions = this.session.configOptions.find(
      (o) => o.id === "model",
    );
    const models: SessionModelState = {
      currentModelId: this.session.modelId ?? DEFAULT_MODEL,
      availableModels:
        modelOptions && "options" in modelOptions
          ? (
              modelOptions.options as Array<{
                value: string;
                name: string;
                description?: string;
              }>
            ).map((opt) => ({
              modelId: opt.value,
              name: opt.name,
              description: opt.description,
            }))
          : [],
    };

    return {
      sessionId,
      modes,
      models,
      configOptions: this.session.configOptions,
    };
  }

  private buildConfigOptions(
    currentModeId: string,
    modelOptions: {
      currentModelId: string;
      options: SessionConfigSelectOption[];
    },
    currentEffort: EffortLevel = "medium",
  ): SessionConfigOption[] {
    const modeOptions = getAvailableModes().map((mode) => ({
      value: mode.id,
      name: mode.name,
      description: mode.description ?? undefined,
    }));

    const configOptions: SessionConfigOption[] = [
      {
        id: "mode",
        name: "Approval Preset",
        type: "select",
        currentValue: currentModeId,
        options: modeOptions,
        category: "mode" as SessionConfigOptionCategory,
        description:
          "Choose an approval and sandboxing preset for your session",
      },
      {
        id: "model",
        name: "Model",
        type: "select",
        currentValue: modelOptions.currentModelId,
        options: modelOptions.options,
        category: "model" as SessionConfigOptionCategory,
        description: "Choose which model Claude should use",
      },
    ];

    const effortOptions = getEffortOptions(modelOptions.currentModelId);
    if (effortOptions) {
      configOptions.push({
        id: "effort",
        name: "Effort",
        type: "select",
        currentValue: currentEffort,
        options: effortOptions,
        category: "thought_level" as SessionConfigOptionCategory,
        description: "Controls how much effort Claude puts into its response",
      });
    }

    return configOptions;
  }

  private rebuildEffortConfigOption(modelId: string): void {
    const effortOptions = getEffortOptions(modelId);
    const existingEffort = this.session.configOptions.find(
      (o) => o.id === "effort",
    );

    if (!effortOptions) {
      this.session.configOptions = this.session.configOptions.filter(
        (o) => o.id !== "effort",
      );
      if (this.session.effort) {
        this.session.effort = undefined;
        this.session.queryOptions.effort = undefined;
        void this.session.query.applyFlagSettings({
          effortLevel: undefined,
        });
      }
      return;
    }

    const rawCurrentValue = existingEffort?.currentValue;
    const currentValue =
      typeof rawCurrentValue === "string" ? rawCurrentValue : "high";
    const isValidValue = effortOptions.some((o) => o.value === currentValue);
    const resolvedValue = isValidValue ? currentValue : "high";

    if (resolvedValue !== currentValue && this.session.effort) {
      this.session.effort = resolvedValue as EffortLevel;
      this.session.queryOptions.effort = resolvedValue as EffortLevel;
      void this.session.query.applyFlagSettings({
        // @ts-expect-error SDK Settings.effortLevel omits "max" but runtime accepts it
        effortLevel: resolvedValue,
      });
    }

    const effortConfig: SessionConfigOption = {
      id: "effort",
      name: "Effort",
      type: "select",
      currentValue: resolvedValue,
      options: effortOptions,
      category: "thought_level" as SessionConfigOptionCategory,
      description: "Controls how much effort Claude puts into its response",
    };

    if (existingEffort) {
      this.session.configOptions = this.session.configOptions.map((o) =>
        o.id === "effort" ? effortConfig : o,
      );
    } else {
      this.session.configOptions.push(effortConfig);
    }
  }

  private async sendAvailableCommandsUpdate(): Promise<void> {
    const commands = await this.session.query.supportedCommands();
    await this.client.sessionUpdate({
      sessionId: this.sessionId,
      update: {
        sessionUpdate: "available_commands_update",
        availableCommands: getAvailableSlashCommands(commands),
      },
    });
  }

  private async replaySessionHistory(sessionId: string): Promise<void> {
    try {
      const messages = await getSessionMessages(sessionId, {
        dir: this.session.cwd,
      });

      const replayContext = {
        session: this.session,
        sessionId,
        client: this.client,
        toolUseCache: this.toolUseCache,
        toolUseStreamCache: this.toolUseStreamCache,
        fileContentCache: this.fileContentCache,
        enrichedReadCache: this.enrichedReadCache,
        logger: this.logger,
        registerHooks: false,
      };

      for (const msg of messages) {
        const sdkMessage = {
          type: msg.type,
          message: msg.message as {
            content: string | Array<{ type: string; text?: string }>;
            role: typeof msg.type;
          },
          parent_tool_use_id: msg.parent_tool_use_id,
        };
        await handleUserAssistantMessage(
          sdkMessage as Parameters<typeof handleUserAssistantMessage>[0],
          replayContext,
        );
      }
    } catch (err) {
      this.logger.warn("Failed to replay session history", {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ================================
  // EXTENSION METHODS
  // ================================

  /**
   * Fire-and-forget: fetch slash commands and MCP tool metadata in parallel.
   * Both populate caches used later — neither is needed to return configOptions.
   */
  private deferBackgroundFetches(q: Query): void {
    Promise.all([
      new Promise<void>((resolve) => setTimeout(resolve, 10)).then(() =>
        this.sendAvailableCommandsUpdate(),
      ),
      fetchMcpToolMetadata(q, this.logger).then(() => {
        const serverNames = getConnectedMcpServerNames();
        if (serverNames.length > 0) {
          this.options?.onMcpServersReady?.(serverNames);
        }
      }),
    ]).catch((err) =>
      this.logger.error("Background fetch failed", { error: err }),
    );
  }

  private async broadcastUserMessage(params: PromptRequest): Promise<void> {
    for (const chunk of params.prompt) {
      const notification = {
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "user_message_chunk" as const,
          content: chunk,
        },
      };
      await this.client.sessionUpdate(notification);
      this.appendNotification(params.sessionId, notification);
    }
  }
}
