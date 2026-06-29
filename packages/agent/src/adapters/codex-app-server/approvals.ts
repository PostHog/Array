/**
 * Handlers for the richer Codex app-server server-requests that carry distinct
 * response shapes rather than a yes/no approval decision string.
 *
 * The hub agent's `handleApproval` already covers the two simple approvals
 * (`item/commandExecution/requestApproval`, `item/fileChange/requestApproval`)
 * by returning "accept"/"decline"/"cancel". The three requests below each
 * expect a *typed response object*, so they live here:
 *
 *  - `item/tool/requestUserInput`  — AskUserQuestion-style multi-question prompt;
 *    response is `{ answers: { [questionId]: { answers: string[] } } }`.
 *  - `item/permissions/requestApproval` — grant a permission profile for a
 *    turn/session; response is `{ permissions, scope }`.
 *  - `mcpServer/elicitation/request` — an MCP server asking the user for
 *    structured input; response is `{ action, content }`.
 *
 * We surface each to the ACP client through `requestPermission` (the only
 * user-prompt primitive ACP gives an agent), mirroring how the Claude adapter
 * maps AskUserQuestion options to permission options and the selected optionId
 * back to an answer. On cancel/error we always default to the safe outcome
 * (empty answers / no permissions granted / decline) so a dropped prompt never
 * silently grants access.
 */

import type {
  AgentSideConnection,
  PermissionOption,
  RequestPermissionResponse,
} from "@agentclientprotocol/sdk";
import type { Logger } from "../../utils/logger";
// Shared with the Claude adapter so synthesized permission option ids round-trip
// the same way across adapters.
import { OPTION_PREFIX } from "../claude/questions/utils";
import { APP_SERVER_REQUESTS } from "./protocol";

// Native app-server param/response shapes (subset of /tmp/codex-schema/v2).
// Re-declared locally so this module stays self-contained and does not depend
// on the generated schema package being present at build time.

interface ToolRequestUserInputOption {
  label: string;
  description: string;
}

interface ToolRequestUserInputQuestion {
  id: string;
  header: string;
  question: string;
  isOther: boolean;
  isSecret: boolean;
  options: ToolRequestUserInputOption[] | null;
}

interface ToolRequestUserInputParams {
  threadId: string;
  turnId: string;
  itemId: string;
  questions: ToolRequestUserInputQuestion[];
  autoResolutionMs: number | null;
}

interface ToolRequestUserInputResponse {
  answers: { [questionId: string]: { answers: string[] } };
}

interface AdditionalNetworkPermissions {
  enabled: boolean | null;
}

interface AdditionalFileSystemPermissions {
  read: string[] | null;
  write: string[] | null;
  globScanMaxDepth?: number;
  entries?: unknown[];
}

interface RequestPermissionProfile {
  network: AdditionalNetworkPermissions | null;
  fileSystem: AdditionalFileSystemPermissions | null;
}

interface PermissionsRequestApprovalParams {
  threadId: string;
  turnId: string;
  itemId: string;
  environmentId: string | null;
  startedAtMs: number;
  cwd: string;
  reason: string | null;
  permissions: RequestPermissionProfile;
}

interface GrantedPermissionProfile {
  network?: AdditionalNetworkPermissions;
  fileSystem?: AdditionalFileSystemPermissions;
}

type PermissionGrantScope = "turn" | "session";

interface PermissionsRequestApprovalResponse {
  permissions: GrantedPermissionProfile;
  scope: PermissionGrantScope;
}

type McpServerElicitationAction = "accept" | "decline" | "cancel";

interface McpServerElicitationRequestParams {
  threadId: string;
  turnId: string | null;
  serverName: string;
  mode: "form" | "url";
  message: string;
  // form mode carries requestedSchema; url mode carries url/elicitationId.
  // We only need `message` to render the prompt, so the rest is untyped here.
  [key: string]: unknown;
}

interface McpServerElicitationRequestResponse {
  action: McpServerElicitationAction;
  content: unknown | null;
  _meta?: unknown | null;
}

export interface HandleServerRequestResult {
  // false → not one of the richer requests; the caller should fall through to
  // its own handling (e.g. the simple command/file approvals).
  handled: boolean;
  response: unknown;
}

export interface HandleServerRequestOptions {
  sessionId: string;
  logger?: Logger;
}

/**
 * Routes a server-initiated request to the matching richer-response handler.
 * Returns `{ handled: false }` for anything this module does not own (including
 * the two simple approvals and unknown methods) so the caller keeps control.
 */
export async function handleServerRequest(
  method: string,
  params: unknown,
  client: Pick<AgentSideConnection, "requestPermission">,
  opts: HandleServerRequestOptions,
): Promise<HandleServerRequestResult> {
  try {
    switch (method) {
      case APP_SERVER_REQUESTS.TOOL_USER_INPUT:
        return {
          handled: true,
          response: await handleToolUserInput(
            params as ToolRequestUserInputParams,
            client,
            opts,
          ),
        };
      case APP_SERVER_REQUESTS.PERMISSIONS_APPROVAL:
        return {
          handled: true,
          response: await handlePermissionsApproval(
            params as PermissionsRequestApprovalParams,
            client,
            opts,
          ),
        };
      case APP_SERVER_REQUESTS.MCP_ELICITATION:
        return {
          handled: true,
          response: await handleMcpElicitation(
            params as McpServerElicitationRequestParams,
            client,
            opts,
          ),
        };
      default:
        return { handled: false, response: undefined };
    }
  } catch (err) {
    // A malformed payload must fail CLOSED to the method's safe default — never
    // throw (the hub would surface a JSON-RPC error the server may treat
    // ambiguously) and never grant.
    opts.logger?.warn("server-request handler threw; failing closed", {
      method,
      error: String(err),
    });
    return { handled: true, response: safeDefaultFor(method) };
  }
}

/** Fail-closed default response per richer-approval method. */
function safeDefaultFor(method: string): unknown {
  if (method === APP_SERVER_REQUESTS.PERMISSIONS_APPROVAL) {
    return { permissions: {}, scope: "turn" };
  }
  if (method === APP_SERVER_REQUESTS.MCP_ELICITATION) {
    return { action: "decline", content: null, _meta: null };
  }
  return { answers: {} };
}

function buildQuestionOptions(
  question: ToolRequestUserInputQuestion,
): PermissionOption[] {
  return (question.options ?? []).map((opt, idx) => ({
    kind: "allow_once" as const,
    name: opt.label,
    optionId: `${OPTION_PREFIX}${idx}`,
    _meta: opt.description ? { description: opt.description } : undefined,
  }));
}

// Maps a selected permission optionId back to the chosen option's label. The id
// is `option_<idx>`, so we index back into the question's options.
function answerFromSelection(
  question: ToolRequestUserInputQuestion,
  optionId: string | undefined,
): string[] {
  if (!optionId || !optionId.startsWith(OPTION_PREFIX)) {
    return [];
  }
  const idx = Number(optionId.slice(OPTION_PREFIX.length));
  const opt = question.options?.[idx];
  return opt ? [opt.label] : [];
}

async function handleToolUserInput(
  params: ToolRequestUserInputParams,
  client: Pick<AgentSideConnection, "requestPermission">,
  opts: HandleServerRequestOptions,
): Promise<ToolRequestUserInputResponse> {
  const answers: ToolRequestUserInputResponse["answers"] = {};

  for (const question of params.questions ?? []) {
    // Default each question to "no answer" so a cancel or failure leaves a
    // well-formed, empty response rather than a missing key.
    answers[question.id] = { answers: [] };

    const options = buildQuestionOptions(question);
    // Free-text ("other"/secret) questions have no selectable options; we can't
    // collect typed input over requestPermission, so leave them empty.
    if (options.length === 0) {
      continue;
    }

    let response: RequestPermissionResponse;
    try {
      response = await client.requestPermission({
        sessionId: opts.sessionId,
        options,
        toolCall: {
          toolCallId: `${params.itemId}:${question.id}`,
          title: question.question,
          kind: "other",
          _meta: { codeToolKind: "question", header: question.header },
        },
      });
    } catch (err) {
      opts.logger?.warn("requestUserInput prompt failed; leaving empty", {
        questionId: question.id,
        error: String(err),
      });
      continue;
    }

    if (response.outcome.outcome !== "selected") {
      // Cancelled → keep the safe empty default.
      continue;
    }
    answers[question.id] = {
      answers: answerFromSelection(question, response.outcome.optionId),
    };
  }

  return { answers };
}

async function handlePermissionsApproval(
  params: PermissionsRequestApprovalParams,
  client: Pick<AgentSideConnection, "requestPermission">,
  opts: HandleServerRequestOptions,
): Promise<PermissionsRequestApprovalResponse> {
  const denied: PermissionsRequestApprovalResponse = {
    permissions: {},
    scope: "turn",
  };

  let response: RequestPermissionResponse;
  try {
    response = await client.requestPermission({
      sessionId: opts.sessionId,
      options: [
        { kind: "allow_once", name: "Allow", optionId: "allow" },
        { kind: "reject_once", name: "Reject", optionId: "reject" },
      ],
      toolCall: {
        toolCallId: params.itemId,
        title: params.reason ?? "Grant additional permissions",
        kind: "other",
      },
    });
  } catch (err) {
    opts.logger?.warn("permissions approval prompt failed; denying", {
      itemId: params.itemId,
      error: String(err),
    });
    return denied;
  }

  if (
    response.outcome.outcome === "selected" &&
    response.outcome.optionId === "allow"
  ) {
    // Grant exactly what was requested, scoped to this turn — the option is
    // "allow_once", so a single click must not grant session-wide access.
    return {
      permissions: grantedFromRequested(params.permissions),
      scope: "turn",
    };
  }
  return denied;
}

function grantedFromRequested(
  requested: RequestPermissionProfile,
): GrantedPermissionProfile {
  const granted: GrantedPermissionProfile = {};
  if (requested.network) {
    granted.network = requested.network;
  }
  if (requested.fileSystem) {
    granted.fileSystem = requested.fileSystem;
  }
  return granted;
}

async function handleMcpElicitation(
  params: McpServerElicitationRequestParams,
  client: Pick<AgentSideConnection, "requestPermission">,
  opts: HandleServerRequestOptions,
): Promise<McpServerElicitationRequestResponse> {
  const declined: McpServerElicitationRequestResponse = {
    action: "decline",
    content: null,
    _meta: null,
  };

  let response: RequestPermissionResponse;
  try {
    response = await client.requestPermission({
      sessionId: opts.sessionId,
      options: [
        { kind: "allow_once", name: "Accept", optionId: "accept" },
        { kind: "reject_once", name: "Decline", optionId: "decline" },
      ],
      toolCall: {
        toolCallId: `${params.serverName}:elicitation`,
        title: params.message || `${params.serverName} requests input`,
        kind: "other",
      },
    });
  } catch (err) {
    opts.logger?.warn("elicitation prompt failed; declining", {
      serverName: params.serverName,
      error: String(err),
    });
    return declined;
  }

  if (response.outcome.outcome === "cancelled") {
    return { action: "cancel", content: null, _meta: null };
  }
  if (
    response.outcome.outcome === "selected" &&
    response.outcome.optionId === "accept"
  ) {
    // We have no structured form UI over requestPermission, so accept with no
    // content. The MCP server treats this as an empty-but-accepted result.
    return { action: "accept", content: {}, _meta: null };
  }
  return declined;
}
