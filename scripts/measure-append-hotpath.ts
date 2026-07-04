// Measures the real appendEvents hot path (the actual store module, no
// replicas): 1 second of heavy streaming = 60 flushes x 15 events over a
// transcript seeded with N events. Run on main and on a branch to compare.
//   node node_modules/.bin/tsx scripts/measure-append-hotpath.ts
// (use tsx/Node so numbers come from V8, the engine Electron ships)
import type { AcpMessage, AgentSession } from "@posthog/shared";
import { sessionStoreSetters } from "../packages/core/src/sessions/sessionStore";

const RUN_ID = "run-bench";
let seq = 0;
function makeEvent(): AcpMessage {
  seq++;
  const message =
    seq % 12 === 0
      ? {
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: RUN_ID,
            update: {
              sessionUpdate: "tool_call_update",
              toolCallId: `tool-${seq % 40}`,
              status: "in_progress",
              rawInput: { file_path: "/src/app.ts", content: "x".repeat(2048) },
            },
          },
        }
      : {
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: RUN_ID,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "word ".repeat(16) },
            },
          },
        };
  return { ts: 1700000000000 + seq, message } as unknown as AcpMessage;
}

function seedSession(n: number): void {
  const events: AcpMessage[] = [];
  for (let i = 0; i < n; i++) events.push(Object.freeze(makeEvent()));
  sessionStoreSetters.setSession({
    taskRunId: RUN_ID,
    taskId: "task-bench",
    events,
    messageQueue: [],
    pendingPermissions: new Map(),
    status: "connected",
  } as unknown as AgentSession);
}

const FRAMES = 60;
const PER_FRAME = 15;

function run(perEvent: boolean): number {
  const batches: AcpMessage[][] = [];
  for (let f = 0; f < FRAMES; f++) {
    const b: AcpMessage[] = [];
    for (let e = 0; e < PER_FRAME; e++) b.push(makeEvent());
    batches.push(b);
  }
  const t0 = performance.now();
  for (const batch of batches) {
    if (perEvent) {
      for (const ev of batch) sessionStoreSetters.appendEvents(RUN_ID, [ev]);
    } else {
      sessionStoreSetters.appendEvents(RUN_ID, batch);
    }
  }
  return performance.now() - t0;
}

for (const n of [10_000, 30_000]) {
  for (const perEvent of [true, false]) {
    const label = perEvent ? "per-event x15" : "coalesced x1 ";
    const times: number[] = [];
    for (let rep = 0; rep < 7; rep++) {
      seedSession(n);
      times.push(run(perEvent));
    }
    times.sort((a, b) => a - b);
    console.log(
      `transcript ${n.toLocaleString("en-US")} | ${label} | median ${times[3].toFixed(1)} ms per streamed second (min ${times[0].toFixed(1)}, max ${times[6].toFixed(1)})`,
    );
  }
}
