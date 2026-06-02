import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { ContentBlock } from "@agentclientprotocol/sdk";
import { DEFAULT_GATEWAY_MODEL } from "../../../gateway-models";
import type { PostHogAPIClient } from "../../../posthog-api";
import type { StoredEntry } from "../../../types";
import { supports1MContext } from "./models";

interface ConversationTurn {
  role: "user" | "assistant";
  content: ContentBlock[];
  toolCalls?: ToolCallInfo[];
}

interface ToolCallInfo {
  toolCallId: string;
  toolName: string;
  input: unknown;
  result?: unknown;
}

interface JsonlConfig {
  sessionId: string;
  cwd: string;
  model?: string;
  version?: string;
  gitBranch?: string;
  slug?: string;
  permissionMode?: string;
}

interface ClaudeCodeMeta {
  toolCallId?: string;
  toolName?: string;
  toolInput?: unknown;
  toolResponse?: unknown;
}

interface SessionUpdate {
  sessionUpdate: string;
  content?: ContentBlock | ContentBlock[];
  _meta?: { claudeCode?: ClaudeCodeMeta };
}

const MAX_PROJECT_KEY_LENGTH = 200;

function hashString(s: string): string {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (hash << 5) - hash + s.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

export function getSessionJsonlPath(sessionId: string, cwd: string): string {
  const configDir =
    process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
  let projectKey = cwd.replace(/[^a-zA-Z0-9]/g, "-");
  if (projectKey.length > MAX_PROJECT_KEY_LENGTH) {
    projectKey = `${projectKey.slice(0, MAX_PROJECT_KEY_LENGTH)}-${hashString(cwd)}`;
  }
  return path.join(configDir, "projects", projectKey, `${sessionId}.jsonl`);
}

export function rebuildConversation(
  entries: StoredEntry[],
): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  let currentAssistantContent: ContentBlock[] = [];
  let currentToolCalls: ToolCallInfo[] = [];

  for (const entry of entries) {
    const method = entry.notification?.method;
    const params = entry.notification?.params as Record<string, unknown>;

    if (method === "session/update" && params?.update) {
      const update = params.update as SessionUpdate;

      switch (update.sessionUpdate) {
        case "user_message":
        case "user_message_chunk": {
          if (
            currentAssistantContent.length > 0 ||
            currentToolCalls.length > 0
          ) {
            turns.push({
              role: "assistant",
              content: currentAssistantContent,
              toolCalls:
                currentToolCalls.length > 0 ? currentToolCalls : undefined,
            });
            currentAssistantContent = [];
            currentToolCalls = [];
          }

          const content = update.content;
          const contentArray = Array.isArray(content)
            ? content
            : content
              ? [content]
              : [];

          const lastTurn = turns[turns.length - 1];
          if (lastTurn?.role === "user") {
            lastTurn.content.push(...contentArray);
          } else {
            turns.push({ role: "user", content: contentArray });
          }
          break;
        }

        case "agent_message":
        case "agent_message_chunk":
        case "agent_thought_chunk": {
          const content = update.content;
          if (content && !Array.isArray(content)) {
            if (
              content.type === "text" &&
              currentAssistantContent.length > 0 &&
              currentAssistantContent[currentAssistantContent.length - 1]
                .type === "text"
            ) {
              const lastBlock = currentAssistantContent[
                currentAssistantContent.length - 1
              ] as { type: "text"; text: string };
              lastBlock.text += (
                content as { type: "text"; text: string }
              ).text;
            } else {
              currentAssistantContent.push(content);
            }
          }
          break;
        }

        case "tool_call":
        case "tool_call_update": {
          const meta = update._meta?.claudeCode;
          if (meta) {
            const { toolCallId, toolName, toolInput, toolResponse } = meta;

            if (toolCallId && toolName) {
              let toolCall = currentToolCalls.find(
                (tc) => tc.toolCallId === toolCallId,
              );
              if (!toolCall) {
                toolCall = { toolCallId, toolName, input: toolInput };
                currentToolCalls.push(toolCall);
              }
              if (toolResponse !== undefined) {
                toolCall.result = toolResponse;
              }
            }
          }
          break;
        }

        case "tool_result": {
          const meta = update._meta?.claudeCode;
          if (meta) {
            const { toolCallId, toolResponse } = meta;
            if (toolCallId) {
              const toolCall = currentToolCalls.find(
                (tc) => tc.toolCallId === toolCallId,
              );
              if (toolCall && toolResponse !== undefined) {
                toolCall.result = toolResponse;
              }
            }
          }
          break;
        }
      }
    }
  }

  if (currentAssistantContent.length > 0 || currentToolCalls.length > 0) {
    turns.push({
      role: "assistant",
      content: currentAssistantContent,
      toolCalls: currentToolCalls.length > 0 ? currentToolCalls : undefined,
    });
  }

  return turns;
}

const CHARS_PER_TOKEN = 4;
const DEFAULT_MAX_TOKENS = 150_000;
const LARGE_CONTEXT_MAX_TOKENS = 800_000;

function estimateTurnTokens(turn: ConversationTurn): number {
  let chars = 0;
  for (const block of turn.content) {
    if ("text" in block && typeof block.text === "string") {
      chars += block.text.length;
    }
  }
  if (turn.toolCalls) {
    for (const tc of turn.toolCalls) {
      chars += JSON.stringify(tc.input ?? "").length;
      if (tc.result !== undefined) {
        chars +=
          typeof tc.result === "string"
            ? tc.result.length
            : JSON.stringify(tc.result).length;
      }
    }
  }
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

export function selectRecentTurns(
  turns: ConversationTurn[],
  maxTokens = DEFAULT_MAX_TOKENS,
): ConversationTurn[] {
  let budget = maxTokens;
  let startIndex = turns.length;

  for (let i = turns.length - 1; i >= 0; i--) {
    const cost = estimateTurnTokens(turns[i]);
    if (cost > budget) break;
    budget -= cost;
    startIndex = i;
  }

  // Ensure we start on a user turn so the conversation is well-formed
  while (startIndex < turns.length && turns[startIndex].role !== "user") {
    startIndex++;
  }

  return turns.slice(startIndex);
}

const BASE62 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function generateMessageId(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let id = "msg_01";
  for (const b of bytes) {
    id += BASE62[b % 62];
  }
  return id;
}

const ADJECTIVES = [
  "bright",
  "calm",
  "daring",
  "eager",
  "fair",
  "gentle",
  "happy",
  "keen",
  "lively",
  "merry",
  "noble",
  "polite",
  "quick",
  "sharp",
  "warm",
  "witty",
];
const VERBS = [
  "blazing",
  "crafting",
  "dashing",
  "flowing",
  "gliding",
  "humming",
  "jumping",
  "linking",
  "melting",
  "nesting",
  "pacing",
  "roaming",
  "sailing",
  "turning",
  "waving",
  "zoning",
];
const NOUNS = [
  "aurora",
  "breeze",
  "cedar",
  "delta",
  "ember",
  "frost",
  "grove",
  "haven",
  "inlet",
  "jewel",
  "knoll",
  "lotus",
  "maple",
  "nexus",
  "oasis",
  "prism",
];

function generateSlug(): string {
  const pick = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];
  return `${pick(ADJECTIVES)}-${pick(VERBS)}-${pick(NOUNS)}`;
}

export function conversationTurnsToJsonlEntries(
  turns: ConversationTurn[],
  config: JsonlConfig,
): string[] {
  const lines: string[] = [];
  let parentUuid: string | null = null;
  const model = config.model ?? DEFAULT_GATEWAY_MODEL;
  const version = config.version ?? "2.1.63";
  const gitBranch = config.gitBranch ?? "";
  const slug = config.slug ?? generateSlug();
  const permissionMode = config.permissionMode ?? "default";
  const baseTime = Date.now() - turns.length * 3000;
  let turnIndex = 0;

  for (const turn of turns) {
    const timestamp = new Date(baseTime + turnIndex * 3000).toISOString();
    turnIndex++;
    if (turn.role === "user") {
      lines.push(
        JSON.stringify({
          type: "queue-operation",
          operation: "enqueue",
          timestamp,
          sessionId: config.sessionId,
        }),
      );
      lines.push(
        JSON.stringify({
          type: "queue-operation",
          operation: "dequeue",
          timestamp,
          sessionId: config.sessionId,
        }),
      );

      const uuid = randomUUID();
      const textParts = turn.content
        .filter(
          (block) =>
            "text" in block && typeof block.text === "string" && block.text,
        )
        .map((block) => (block as { text: string }).text);

      const userText = textParts.length > 0 ? textParts.join("") : " ";

      lines.push(
        JSON.stringify({
          parentUuid,
          isSidechain: false,
          userType: "external",
          cwd: config.cwd,
          sessionId: config.sessionId,
          version,
          gitBranch,
          slug,
          type: "user",
          message: {
            role: "user",
            content: [{ type: "text", text: userText }],
          },
          uuid,
          timestamp,
          permissionMode,
        }),
      );
      parentUuid = uuid;
    } else {
      const allBlocks: unknown[] = [];

      for (const block of turn.content) {
        const blockType = (block as { type: string }).type;
        if (blockType === "thinking" || blockType === "text") {
          allBlocks.push(block);
        }
      }

      if (turn.toolCalls) {
        for (const tc of turn.toolCalls) {
          allBlocks.push({
            type: "tool_use",
            id: tc.toolCallId,
            name: tc.toolName,
            input: tc.input,
          });
        }
      }

      const msgId = generateMessageId();
      const hasToolUse = allBlocks.some(
        (b) => (b as { type: string }).type === "tool_use",
      );
      const lastStopReason = hasToolUse ? "tool_use" : "end_turn";

      for (let i = 0; i < allBlocks.length; i++) {
        const block = allBlocks[i];
        const isLast = i === allBlocks.length - 1;
        const uuid = randomUUID();

        lines.push(
          JSON.stringify({
            parentUuid,
            isSidechain: false,
            userType: "external",
            cwd: config.cwd,
            sessionId: config.sessionId,
            version,
            gitBranch,
            slug,
            type: "assistant",
            message: {
              model,
              id: msgId,
              type: "message",
              role: "assistant",
              content: [block],
              stop_reason: isLast ? lastStopReason : null,
              stop_sequence: null,
              usage: {
                input_tokens: 0,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: 0,
                output_tokens: 0,
              },
            },
            uuid,
            timestamp,
          }),
        );
        parentUuid = uuid;
      }

      if (turn.toolCalls) {
        for (const tc of turn.toolCalls) {
          if (tc.result === undefined) continue;

          const uuid = randomUUID();
          const resultText =
            typeof tc.result === "string"
              ? tc.result
              : JSON.stringify(tc.result);

          lines.push(
            JSON.stringify({
              parentUuid,
              isSidechain: false,
              userType: "external",
              cwd: config.cwd,
              sessionId: config.sessionId,
              version,
              gitBranch,
              slug,
              type: "user",
              message: {
                role: "user",
                content: [
                  {
                    type: "tool_result",
                    tool_use_id: tc.toolCallId,
                    content: resultText,
                  },
                ],
              },
              uuid,
              timestamp,
            }),
          );
          parentUuid = uuid;
        }
      }
    }
  }

  return lines;
}

interface HydrationLog {
  info: (msg: string, data?: unknown) => void;
  warn: (msg: string, data?: unknown) => void;
}

export async function hydrateSessionJsonl(params: {
  sessionId: string;
  cwd: string;
  taskId: string;
  runId: string;
  model?: string;
  gitBranch?: string;
  permissionMode?: string;
  posthogAPI: PostHogAPIClient;
  log: HydrationLog;
}): Promise<boolean> {
  const { posthogAPI, log } = params;

  try {
    const jsonlPath = getSessionJsonlPath(params.sessionId, params.cwd);
    try {
      await fs.access(jsonlPath);
      return true;
    } catch {
      // File doesn't exist, proceed with hydration
    }

    const taskRun = await posthogAPI.getTaskRun(params.taskId, params.runId);
    if (!taskRun.log_url) {
      log.info("No log URL, skipping JSONL hydration");
      return false;
    }

    const entries = await posthogAPI.fetchTaskRunLogs(taskRun);
    if (entries.length === 0) {
      log.info("No S3 log entries, skipping JSONL hydration");
      return false;
    }

    const entryCounts: Record<string, number> = {};
    for (const entry of entries) {
      const method = entry.notification?.method ?? "unknown";
      const entryParams = entry.notification?.params as
        | Record<string, unknown>
        | undefined;
      const update = entryParams?.update as
        | { sessionUpdate?: string }
        | undefined;
      const key = update?.sessionUpdate
        ? `${method}:${update.sessionUpdate}`
        : method;
      entryCounts[key] = (entryCounts[key] ?? 0) + 1;
    }
    log.info("S3 log entry breakdown", {
      totalEntries: entries.length,
      types: entryCounts,
    });

    const allTurns = rebuildConversation(entries);
    if (allTurns.length === 0) {
      log.info("No conversation in S3 logs, skipping JSONL hydration");
      return false;
    }

    const maxTokens = supports1MContext(params.model ?? "")
      ? LARGE_CONTEXT_MAX_TOKENS
      : DEFAULT_MAX_TOKENS;
    const conversation = selectRecentTurns(allTurns, maxTokens);
    log.info("Selected recent turns for hydration", {
      totalTurns: allTurns.length,
      selectedTurns: conversation.length,
      turnRoles: conversation.map((t) => t.role),
    });

    const jsonlLines = conversationTurnsToJsonlEntries(conversation, {
      sessionId: params.sessionId,
      cwd: params.cwd,
      model: params.model,
      gitBranch: params.gitBranch,
      permissionMode: params.permissionMode,
    });

    await fs.mkdir(path.dirname(jsonlPath), { recursive: true });

    const tmpPath = `${jsonlPath}.tmp.${Date.now()}`;
    await fs.writeFile(tmpPath, `${jsonlLines.join("\n")}\n`);
    await fs.rename(tmpPath, jsonlPath);

    log.info("Hydrated session JSONL from S3", {
      sessionId: params.sessionId,
      turns: conversation.length,
      lines: jsonlLines.length,
    });
    return true;
  } catch (err) {
    log.warn("Failed to hydrate session JSONL, continuing", {
      sessionId: params.sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
