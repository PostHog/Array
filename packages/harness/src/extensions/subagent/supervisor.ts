/**
 * A blocked child can "contact the supervisor" (the parent session) and wait
 * for a reply. Children run as separate OS processes with no shared memory
 * or `pi.events` bus with the parent, so this is necessarily file-based: a
 * per-run mailbox directory (colocated with that run's `lifecycle.ts`
 * artifacts) that the child polls for a reply and the parent writes into.
 */
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { runDirectory } from "./lifecycle";

const DEFAULT_SUPERVISOR_TIMEOUT_MS = 15 * 60_000;

export type SupervisorReason = "need_decision" | "blocked" | "clarify";

export interface SupervisorRequest {
  requestId: string;
  runId: string;
  reason: SupervisorReason;
  message: string;
  createdAt: number;
}

function mailboxDir(runId: string): string {
  return path.join(runDirectory(runId), "supervisor");
}

function requestPath(runId: string, requestId: string): string {
  return path.join(mailboxDir(runId), `request-${requestId}.json`);
}

function replyPath(runId: string, requestId: string): string {
  return path.join(mailboxDir(runId), `reply-${requestId}.json`);
}

// --- Child side -------------------------------------------------------

export function writeSupervisorRequest(
  runId: string,
  reason: SupervisorReason,
  message: string,
): SupervisorRequest {
  const dir = mailboxDir(runId);
  fs.mkdirSync(dir, { recursive: true });
  const request: SupervisorRequest = {
    requestId: randomUUID(),
    runId,
    reason,
    message,
    createdAt: Date.now(),
  };
  fs.writeFileSync(
    requestPath(runId, request.requestId),
    JSON.stringify(request),
  );
  return request;
}

export interface WaitForSupervisorReplyOptions {
  pollIntervalMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** Polls for a reply, returning `undefined` on timeout or abort rather than throwing. */
export async function waitForSupervisorReply(
  runId: string,
  requestId: string,
  options: WaitForSupervisorReplyOptions = {},
): Promise<string | undefined> {
  const pollIntervalMs = options.pollIntervalMs ?? 500;
  const deadline =
    options.timeoutMs !== undefined
      ? Date.now() + options.timeoutMs
      : undefined;
  const path_ = replyPath(runId, requestId);

  for (;;) {
    if (options.signal?.aborted) return undefined;
    if (fs.existsSync(path_)) {
      try {
        const data = JSON.parse(fs.readFileSync(path_, "utf-8")) as {
          message: string;
        };
        return data.message;
      } catch {
        return undefined;
      }
    }
    if (deadline !== undefined && Date.now() >= deadline) return undefined;
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

// --- Parent side -------------------------------------------------------

export function listPendingSupervisorRequests(
  runId: string,
): SupervisorRequest[] {
  const dir = mailboxDir(runId);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const requests: SupervisorRequest[] = [];
  for (const entry of entries) {
    if (!entry.name.startsWith("request-") || !entry.name.endsWith(".json"))
      continue;
    const requestId = entry.name.slice("request-".length, -".json".length);
    if (fs.existsSync(replyPath(runId, requestId))) continue;
    try {
      requests.push(
        JSON.parse(
          fs.readFileSync(requestPath(runId, requestId), "utf-8"),
        ) as SupervisorRequest,
      );
    } catch {
      /* ignore malformed request files */
    }
  }
  return requests.sort((a, b) => a.createdAt - b.createdAt);
}

export function replyToSupervisorRequest(
  runId: string,
  requestId: string,
  message: string,
): void {
  const dir = mailboxDir(runId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    replyPath(runId, requestId),
    JSON.stringify({ message, repliedAt: Date.now() }),
  );
}

/**
 * Writes a generated child-side extension that registers a `contact_supervisor`
 * tool: the child writes a request into this run's mailbox and blocks (up to
 * `timeoutMs`) waiting for the parent to reply. Resolves `supervisor.js` and
 * `typebox` by absolute path so the generated file works from any tmp
 * directory, regardless of the child's own module resolution.
 */
export async function writeSupervisorBridgeExtension(
  runId: string,
  timeoutMs: number = DEFAULT_SUPERVISOR_TIMEOUT_MS,
): Promise<{ dir: string; filePath: string }> {
  const supervisorModulePath = fileURLToPath(
    new URL("./supervisor.js", import.meta.url),
  );
  const typeboxModulePath = fileURLToPath(import.meta.resolve("typebox"));

  const tmpDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "posthog-subagent-supervisor-"),
  );
  const filePath = path.join(tmpDir, "supervisor-bridge.mjs");

  const source = `import { Type } from ${JSON.stringify(typeboxModulePath)};
import { writeSupervisorRequest, waitForSupervisorReply } from ${JSON.stringify(supervisorModulePath)};

export default function (pi) {
  pi.registerTool({
    name: "contact_supervisor",
    label: "Contact Supervisor",
    description: "Ask the orchestrating parent session a question or report a blocker, and wait for its reply. Use sparingly — the parent may be unavailable and this can time out.",
    parameters: Type.Object({
      reason: Type.Union([Type.Literal("need_decision"), Type.Literal("blocked"), Type.Literal("clarify")]),
      message: Type.String({ description: "The question or blocker to report to the parent." }),
    }),
    async execute(_toolCallId, params, signal) {
      const request = writeSupervisorRequest(${JSON.stringify(runId)}, params.reason, params.message);
      const reply = await waitForSupervisorReply(${JSON.stringify(runId)}, request.requestId, { timeoutMs: ${JSON.stringify(timeoutMs)}, signal });
      return {
        content: [{ type: "text", text: reply ?? "(no reply from the supervisor within the timeout; proceed using your best judgment)" }],
        details: {},
      };
    },
  });
}
`;

  await withFileMutationQueue(filePath, async () => {
    await fs.promises.writeFile(filePath, source, {
      encoding: "utf-8",
      mode: 0o600,
    });
  });
  return { dir: tmpDir, filePath };
}

export interface SupervisorPoller {
  stop: () => void;
}

/**
 * Polls a run's mailbox and calls `onRequest` for each new pending request,
 * writing whatever it resolves to back as the reply. Used by `run-agent.ts`
 * to surface a live child's questions to `ctx.ui` while the parent tool call
 * is still active (foreground/parallel/chain). Not used for `background`
 * runs — there is no live UI to ask once the tool call has already returned.
 */
export function pollSupervisorRequests(
  runId: string,
  onRequest: (request: SupervisorRequest) => Promise<string> | string,
  intervalMs = 500,
): SupervisorPoller {
  const seen = new Set<string>();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  // `tick` is invoked via bare `setTimeout`, whose callback return value is
  // ignored — an uncaught rejection here would both (a) silently stop the
  // poller forever (the reschedule line below would never run) and (b)
  // surface as an unhandled promise rejection in the parent process. Both are
  // real risks: `onRequest` can call `ctx.ui.input(...)`, a real UI prompt
  // that can reject. Catch everything so a single bad request never takes
  // down the poller or the process.
  const tick = async () => {
    if (stopped) return;
    try {
      const pending = listPendingSupervisorRequests(runId);
      for (const request of pending) {
        if (seen.has(request.requestId) || stopped) continue;
        seen.add(request.requestId);
        try {
          const reply = await onRequest(request);
          replyToSupervisorRequest(runId, request.requestId, reply);
        } catch {
          /* onRequest/reply failed for this request; leave it unanswered so
           * the child's own wait times out rather than hanging forever or
           * crashing the poller. */
        }
      }
    } catch {
      /* listing the mailbox failed (e.g. transient fs error); try again next tick. */
    } finally {
      if (!stopped) timer = setTimeout(tick, intervalMs);
    }
  };

  timer = setTimeout(tick, intervalMs);
  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
