/**
 * Lets other in-process extensions spawn/interrupt/stop subagents and check
 * status through pi's shared event bus (`pi.events`), without depending on
 * this package. Versioned so the wire format can evolve independently of
 * this extension's internal modules.
 *
 * `pi.events` handlers only receive plain data, not an `ExtensionContext` —
 * `spawn` needs one (to resolve the caller's model/credentials via
 * `run-agent.ts`). We cache the most recently seen `ExtensionContext` from
 * broad, frequent lifecycle events (`session_start`, `turn_start`) so a
 * reasonably fresh one is available whenever an RPC `spawn` request arrives.
 */
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { findBundledAgent, listBundledAgentNames } from "./agents";
import { backgroundRuns } from "./background-runner";
import { listRuns } from "./lifecycle";

export const SUBAGENT_RPC_VERSION = 1;
export const SUBAGENT_RPC_REQUEST_CHANNEL = "subagents:rpc:v1:request";

export function subagentRpcReplyChannel(requestId: string): string {
  return `subagents:rpc:v1:reply:${requestId}`;
}

export type SubagentRpcMethod =
  | "ping"
  | "status"
  | "spawn"
  | "interrupt"
  | "stop";

export interface SubagentRpcRequest {
  version: 1;
  requestId: string;
  method: SubagentRpcMethod;
  params?: {
    agent?: string;
    task?: string;
    context?: string;
    runId?: string;
  };
}

export type SubagentRpcReply =
  | { version: 1; requestId: string; success: true; data: unknown }
  | { version: 1; requestId: string; success: false; error: string };

function isSubagentRpcRequest(data: unknown): data is SubagentRpcRequest {
  if (!data || typeof data !== "object") return false;
  const candidate = data as Partial<SubagentRpcRequest>;
  return (
    candidate.version === SUBAGENT_RPC_VERSION &&
    typeof candidate.requestId === "string" &&
    typeof candidate.method === "string"
  );
}

async function handleRequest(
  pi: ExtensionAPI,
  getCtx: () => ExtensionContext | undefined,
  request: SubagentRpcRequest,
): Promise<void> {
  const reply = (data: unknown) => {
    const message: SubagentRpcReply = {
      version: SUBAGENT_RPC_VERSION,
      requestId: request.requestId,
      success: true,
      data,
    };
    pi.events.emit(subagentRpcReplyChannel(request.requestId), message);
  };
  const replyError = (error: string) => {
    const message: SubagentRpcReply = {
      version: SUBAGENT_RPC_VERSION,
      requestId: request.requestId,
      success: false,
      error,
    };
    pi.events.emit(subagentRpcReplyChannel(request.requestId), message);
  };

  try {
    switch (request.method) {
      case "ping": {
        reply({ pong: true, version: SUBAGENT_RPC_VERSION });
        return;
      }
      case "status": {
        const runId = request.params?.runId;
        if (runId) {
          const run = listRuns().find((r) => r.runId === runId);
          if (!run) return replyError(`Unknown runId "${runId}".`);
          return reply(run);
        }
        reply({ runs: listRuns() });
        return;
      }
      case "interrupt":
      case "stop": {
        const runId = request.params?.runId;
        if (!runId) return replyError("interrupt/stop requires params.runId.");
        const interrupted = backgroundRuns.interrupt(runId);
        reply({ interrupted });
        return;
      }
      case "spawn": {
        const { agent: agentName, task } = request.params ?? {};
        if (!agentName || !task)
          return replyError("spawn requires params.agent and params.task.");

        const agent = findBundledAgent(agentName);
        if (!agent)
          return replyError(
            `Unknown agent "${agentName}". Available: ${listBundledAgentNames().join(", ")}`,
          );

        const ctx = getCtx();
        if (!ctx)
          return replyError(
            "No active session context available to spawn a subagent from yet.",
          );

        // Lazy import to avoid a module cycle with run-agent.ts at module-eval time.
        const { runAgent } = await import("./run-agent");
        const handle = backgroundRuns.start(
          { mode: "single", agents: [agentName] },
          async (signal) => {
            const result = await runAgent({
              ctx,
              agent,
              task,
              context: request.params?.context,
              signal,
            });
            return { model: result.model, childRunIds: [result.runId] };
          },
        );
        reply({ runId: handle.runId });
        return;
      }
      default:
        replyError(`Unknown method "${request.method}".`);
    }
  } catch (error) {
    replyError(error instanceof Error ? error.message : String(error));
  }
}

/** Registers the RPC listener. Call once from the extension factory. */
export function registerSubagentRpc(pi: ExtensionAPI): void {
  let latestCtx: ExtensionContext | undefined;
  pi.on("session_start", (_event, ctx) => {
    latestCtx = ctx;
  });
  pi.on("turn_start", (_event, ctx) => {
    latestCtx = ctx;
  });

  pi.events.on(SUBAGENT_RPC_REQUEST_CHANNEL, (data) => {
    if (!isSubagentRpcRequest(data)) return;
    void handleRequest(pi, () => latestCtx, data);
  });
}
