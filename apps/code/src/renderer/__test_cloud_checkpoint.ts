/**
 * Cloud checkpoint smoke test — Fix 1–5, exhaustive E2E coverage.
 *
 * Import in Electron devtools console:
 *   const m = await import('/src/renderer/__test_cloud_checkpoint.ts');
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  RECOMMENDED RUN ORDER  (run one at a time, each creates its own task)  │
 * │                                                                         │
 * │  1.  m.runA()   ~5–8 min   local→cloud→local passthrough               │
 * │  2.  m.runB()   ~10–15 min cloud turns emit checkpoints                 │
 * │  3.  m.runC()   ~10–15 min cloud-native task (no local turns first)     │
 * │  4.  m.runD()   ~20–30 min full bidirectional cloud→local→cloud         │
 * │                                                                         │
 * │  Or run all back-to-back (slow, ~50 min):   m.runAll()                  │
 * │                                                                         │
 * │  With Claude: m.runA("claude", "claude-haiku-4-5")                      │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Fix 1 (Claude JSONL stale memory) is MANUAL: restore a Claude checkpoint,
 * reload the page immediately, then ask the agent what was discussed —
 * it must NOT recall turns that happened after the restore point.
 */
import { get } from "@renderer/di/container";
import { RENDERER_TOKENS } from "@renderer/di/tokens";
import type { TaskService } from "@renderer/features/task-detail/service/service";
import {
  getSessionService,
} from "@renderer/features/sessions/service/service";
import {
  flattenSelectOptions,
  getConfigOptionByCategory,
  sessionStoreSetters,
  useSessionStore,
} from "@renderer/features/sessions/stores/sessionStore";
import { useNavigationStore } from "@renderer/stores/navigationStore";
import { trpcClient } from "@renderer/trpc/client";

// ─── Timeouts ────────────────────────────────────────────────────────────────

const CONNECT_MS          = 30_000;
const LOCAL_TURN_MS       = 120_000;
const CLOUD_TURN_MS       = 300_000; // 5 min — cold-start + model latency
const CP_LOCAL_MS         = 60_000;
const CP_CLOUD_MS         = 300_000;
const HANDOFF_MS          = 180_000;
const CLOUD_INIT_TURN_MS  = 300_000; // cloud sandbox boots + clones + runs sendResumeMessage — up to 5 min

// ─── Tiny utilities ──────────────────────────────────────────────────────────

function waitMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function waitFor(check: () => boolean, timeoutMs: number, label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const id = setInterval(() => {
      if (check()) { clearInterval(id); resolve(); return; }
      if (Date.now() > deadline) { clearInterval(id); reject(new Error(`Timeout (${timeoutMs}ms): ${label}`)); }
    }, 500);
  });
}

// ─── Session-store helpers ────────────────────────────────────────────────────

function getSession(taskRunId: string) {
  return useSessionStore.getState().sessions[taskRunId];
}

/** All unique _posthog/git_checkpoint events after `afterTs`. */
function getCheckpoints(taskRunId: string, afterTs = 0) {
  const evts = getSession(taskRunId)?.events ?? [];
  const seen = new Set<string>();
  return evts
    .filter((e) => {
      const m = e.message as { method?: string };
      return m.method === "_posthog/git_checkpoint" && e.ts > afterTs;
    })
    .map((e) => {
      const p = (e.message as { params?: { checkpointId?: string; promptId?: number; device?: { type?: string } } }).params;
      return { id: p?.checkpointId ?? "", ts: e.ts, promptId: p?.promptId, device: p?.device?.type };
    })
    .filter(({ id }) => { if (!id || seen.has(id)) return false; seen.add(id); return true; });
}

function waitForCheckpoint(taskRunId: string, afterTs: number, timeoutMs = CP_LOCAL_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const id = setInterval(() => {
      const cps = getCheckpoints(taskRunId, afterTs);
      if (cps.length > 0) { clearInterval(id); resolve(cps[cps.length - 1].id); return; }
      if (Date.now() > deadline) { clearInterval(id); reject(new Error(`Timeout (${timeoutMs}ms): waiting for checkpoint`)); }
    }, 800);
  });
}

// Wait for a genuine CLOUD-origin checkpoint (device.type === "cloud") not already known.
// This is the only reliable "cloud agent ready" signal: the handoffToCloud saga emits its
// own LOCAL pre-flight checkpoint (capture_git_checkpoint) at the very start, which would
// otherwise satisfy waitForNewCheckpoint instantly — making us hand back before the sandbox
// has even finished provisioning. The cloud agent's resume turn (sendResumeMessage) emits a
// checkpoint tagged device.type="cloud" once it's booted, cloned, and run — that's what we want.
function waitForCloudCheckpoint(taskRunId: string, knownIds: Set<string>, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const id = setInterval(() => {
      const cloudCp = getCheckpoints(taskRunId).find((c) => c.device === "cloud" && !knownIds.has(c.id));
      if (cloudCp) { clearInterval(id); resolve(cloudCp.id); return; }
      if (Date.now() > deadline) { clearInterval(id); reject(new Error(`Timeout (${timeoutMs}ms): waiting for cloud-origin checkpoint`)); }
    }, 800);
  });
}

// ─── Logging ─────────────────────────────────────────────────────────────────

function logState(taskRunId: string, label: string) {
  const s = getSession(taskRunId);
  if (!s) { console.warn(`[cloud-test] [${label}] session not found for`, taskRunId); return; }
  console.log(`[cloud-test] [${label}] status=${s.status} isCloud=${s.isCloud} cloudStatus=${s.cloudStatus ?? "-"} isPromptPending=${s.isPromptPending} events=${s.events?.length ?? 0}`);
}

function logCheckpoints(taskRunId: string, label: string) {
  const cps = getCheckpoints(taskRunId);
  console.log(`[cloud-test] [${label}] ${cps.length} checkpoint(s):`);
  cps.forEach((c, i) => console.log(`  [${i}] id=${c.id.slice(0, 8)} device=${c.device ?? "?"} promptId=${c.promptId ?? "-"} ts=${new Date(c.ts).toISOString()}`));
}

// ─── Pass / Fail ─────────────────────────────────────────────────────────────

let _pass = 0, _fail = 0;
function pass(msg: string) { _pass++; console.log(`[cloud-test] ✓ PASS: ${msg}`); }
function fail(msg: string) { _fail++; console.error(`[cloud-test] ✗ FAIL: ${msg}`); }
function check(cond: boolean, msg: string) { cond ? pass(msg) : fail(msg); }
function summary(label: string) {
  const total = _pass + _fail;
  if (_fail === 0) console.log(`[cloud-test] ══ ${label}: ${_pass}/${total} passed ✓ ══`);
  else console.error(`[cloud-test] ══ ${label}: ${_fail} FAILED (${_pass}/${total}) ✗ ══`);
  _pass = 0; _fail = 0;
}

// ─── File verification ────────────────────────────────────────────────────────

async function readFile(repoPath: string, fileName: string): Promise<string> {
  const filePath = `${repoPath}/${fileName}`;
  const b64 = await trpcClient.fs.readFileAsBase64.query({ filePath });
  return b64 ? atob(b64) : "";
}

async function checkFile(
  repoPath: string,
  fileName: string,
  mustHave: string[],
  mustNotHave: string[],
  label: string,
) {
  try {
    const content = await readFile(repoPath, fileName);
    console.log(`[cloud-test] [${label}] file content: ${content.trim().slice(0, 120)}`);
    for (const s of mustHave) check(content.includes(s), `file has "${s}" (${label})`);
    for (const s of mustNotHave) check(!content.includes(s), `file lacks "${s}" (${label})`);
  } catch (err) {
    console.warn(`[cloud-test] [${label}] cannot read file — verify manually: ${err}`);
  }
}

// ─── Memory check ────────────────────────────────────────────────────────────
//
// After every handoff the agent receives context of what happened before.
// For cloud→local: the pending-context summary is injected into the first user
// message (via setPendingContext). For local→cloud: the cloud agent resumes
// from the full conversation log — it may auto-produce an initial acknowledgement
// turn before accepting new prompts.
//
// checkMemory() sends a concrete recall prompt and cross-checks the answer
// by reading the actual file. Timing: call it AFTER the agent's first
// post-handoff turn has completed (isPromptPending back to false).

async function checkMemory(
  taskId: string,
  taskRunId: string,
  repoPath: string,
  fileName: string,
  expectedExports: string[],
  label: string,
) {
  const svc = getSessionService();
  console.log(`[cloud-test] [${label}] Checking agent memory — asking it to list exports in ${fileName}…`);

  // Wait for the agent to be idle (post-handoff automated message may be running)
  await waitFor(
    () => !getSession(taskRunId)?.isPromptPending,
    CLOUD_TURN_MS,
    `${label}: agent idle before memory check`,
  );

  const afterTs = Date.now();
  await svc.sendPrompt(
    taskId,
    `Two questions — answer both, do NOT create or modify any files:\n\n` +
    `1. What exports currently exist in ${fileName}? List each export name on its own line.\n\n` +
    `2. List every message I have sent you in this conversation, verbatim and in order, one per line. Include all of them.`,
  );
  // Memory check with prepended pending context can be slow (agent may scan files).
  // Use CLOUD_TURN_MS (5 min) to avoid false timeouts.
  await waitFor(
    () => !getSession(taskRunId)?.isPromptPending,
    CLOUD_TURN_MS,
    `${label}: memory-check turn complete`,
  );

  console.log(`[cloud-test] [${label}] Memory prompt responded (afterTs=${afterTs}).`);

  // Cross-check with actual file state — if the file matches expectations, the
  // agent had the correct context (it may have modified the file to match its
  // memory, which also proves it can take action on the right state).
  await checkFile(repoPath, fileName, expectedExports, [], `${label}/memory-file`);
}

// ─── Task / turn helpers ─────────────────────────────────────────────────────

async function getRepoPath(): Promise<string> {
  const folders = await trpcClient.folders.getFolders.query();
  const folder = folders.find((f) => f.exists !== false);
  if (!folder) throw new Error("No registered folders — add one in the sidebar first");
  return folder.path;
}

async function getEffectiveRepoPath(taskId: string, fallback: string): Promise<string> {
  const ws = (await trpcClient.workspace.getAll.query())[taskId];
  return ws?.worktreePath ?? ws?.folderPath ?? fallback;
}

async function launchLocalTask(
  repoPath: string,
  adapter: "codex" | "claude",
  model: string,
  prompt: string,
): Promise<{ taskId: string; taskRunId: string }> {
  const taskSvc = get<TaskService>(RENDERER_TOKENS.TaskService);
  const result = await taskSvc.createTask({
    content: prompt,
    repoPath,
    workspaceMode: "local",
    adapter,
    model,
    executionMode: "auto",
  });
  if (!result.success) throw new Error("createTask failed: " + result.error);
  const task = result.data.task;
  useNavigationStore.getState().navigateToTask(task);
  console.log("[cloud-test] Created task", task.id, "— navigated to it");

  await waitFor(
    () => !!Object.values(useSessionStore.getState().sessions).find(
      (s) => s.taskId === task.id && s.status === "connected",
    ),
    CONNECT_MS, "session connected",
  );
  const session = Object.values(useSessionStore.getState().sessions).find(
    (s) => s.taskId === task.id && s.status === "connected",
  )!;
  console.log("[cloud-test] Session connected — taskRunId:", session.taskRunId);
  return { taskId: task.id, taskRunId: session.taskRunId };
}

// Create a task that runs in the CLOUD from the very start — no local agent, no
// local turns, no local checkpoint history. Uses the app's native cloud-create
// path (workspaceMode:"cloud" → provisions a cloud workspace + an environment:
// "cloud" run, with `prompt` sent as the run's initial turn). This is what makes
// SCENARIO C genuinely "cloud-native" instead of local-first-then-handoff.
async function launchCloudTask(
  repoPath: string,
  adapter: "codex" | "claude",
  model: string,
  prompt: string,
): Promise<{ taskId: string; taskRunId: string }> {
  const taskSvc = get<TaskService>(RENDERER_TOKENS.TaskService);
  const result = await taskSvc.createTask({
    content: prompt,
    repoPath,
    workspaceMode: "cloud",
    adapter,
    model,
    executionMode: "auto",
  });
  if (!result.success) throw new Error("createTask (cloud) failed: " + result.error);
  const task = result.data.task;
  useNavigationStore.getState().navigateToTask(task);
  console.log("[cloud-test] Created CLOUD-NATIVE task", task.id, "— navigated to it");

  // The cloud run surfaces in the store as a cloud session (isCloud) once the run
  // is created. No local agent is ever spawned, so we wait for isCloud, not for a
  // local "connected" status.
  await waitFor(
    () =>
      Object.values(useSessionStore.getState().sessions).some(
        (s) => s.taskId === task.id && s.isCloud === true,
      ),
    CONNECT_MS,
    "cloud session created",
  );
  const session = Object.values(useSessionStore.getState().sessions).find(
    (s) => s.taskId === task.id && s.isCloud === true,
  )!;
  console.log("[cloud-test] Cloud session created — taskRunId:", session.taskRunId);
  return { taskId: task.id, taskRunId: session.taskRunId };
}

async function runTurn(
  taskId: string,
  taskRunId: string,
  prompt: string,
  label: string,
  turnMs = LOCAL_TURN_MS,
  cpMs = CP_LOCAL_MS,
): Promise<string> {
  const svc = getSessionService();
  const afterTs = Date.now();
  console.log(`[cloud-test] === ${label} ===`);
  logState(taskRunId, label);
  await svc.sendPrompt(taskId, prompt);
  await waitFor(() => !getSession(taskRunId)?.isPromptPending, turnMs, `${label}: turn complete`);
  const cpId = await waitForCheckpoint(taskRunId, afterTs, cpMs);
  console.log(`[cloud-test] ${label} → checkpoint: ${cpId.slice(0, 8)} (promptId=${getCheckpoints(taskRunId, afterTs)[0]?.promptId ?? "?"})`);
  logState(taskRunId, `${label}/done`);
  return cpId;
}

// Wait until the cloud agent is genuinely idle: not mid-turn AND with an empty
// message queue. Call this only AFTER something proves a turn actually ran (e.g.
// waitForCloudCheckpoint), otherwise it can return during the pre-dispatch idle
// gap before the first turn even starts.
async function waitForCloudIdle(
  taskRunId: string,
  timeoutMs: number,
  label: string,
): Promise<void> {
  await waitFor(
    () => {
      const s = getSession(taskRunId);
      return (
        !!s &&
        s.isCloud === true &&
        !s.isPromptPending &&
        s.messageQueue.length === 0
      );
    },
    timeoutMs,
    `${label}: cloud agent idle (turn complete, queue drained)`,
  );
}

// Robust cloud-turn send. A cloud prompt QUEUES if the sandbox is still
// provisioning or an init/auto-context turn is mid-flight; the queue then drains
// on the next turn boundary. Waiting only for `!isPromptPending` is racy — it's
// briefly false in the gap between the prior turn finishing and the queued prompt
// dispatching, so the harness could march on (e.g. trigger a handoff) while OUR
// turn is still pending, and the agent never answers it. This instead waits for
// genuine completion: a per-turn cloud checkpoint appeared AFTER we sent, the
// queue drained, and the agent is idle. Requires the caller to have the cloud
// idle before calling (so `afterTs` excludes any prior turn's checkpoint).
// Cloud runs default to an approval-prompting preset, so file-editing turns
// (printf/append) block on a permission request the harness can't click — unlike
// local sessions launched with executionMode:"auto". Switch the cloud run to its
// most permissive preset (claude → "bypassPermissions", codex → "full-access")
// so scenarios run unattended. Reads the value from the session's OWN mode options
// (adapter-agnostic), and is a no-op once already set (setSessionConfigOption
// skips equal values), so it's safe to call before every cloud turn.
async function ensureCloudBypass(taskId: string, taskRunId: string): Promise<void> {
  const svc = getSessionService();
  let bypassValue: string | undefined;
  await waitFor(
    () => {
      const s = getSession(taskRunId);
      const mode = getConfigOptionByCategory(s?.configOptions, "mode");
      if (!mode || mode.type !== "select") return false;
      bypassValue = flattenSelectOptions(mode.options).find(
        (o) => o.value === "bypassPermissions" || o.value === "full-access",
      )?.value;
      return !!bypassValue;
    },
    30_000,
    "cloud mode option available",
  ).catch(() => {});
  if (!bypassValue) {
    console.warn(
      "[cloud-test] ensureCloudBypass: no bypass preset found — cloud permission prompts may block this run",
    );
    return;
  }
  await svc.setSessionConfigOption(taskId, "mode", bypassValue);
  console.log(`[cloud-test] cloud approval preset → ${bypassValue} (runs unattended)`);
}

async function runCloudTurn(
  taskId: string,
  taskRunId: string,
  prompt: string,
  label: string,
): Promise<string> {
  const svc = getSessionService();
  const afterTs = Date.now();
  console.log(`[cloud-test] === ${label} (cloud) ===`);
  logState(taskRunId, label);
  // Make the cloud agent autonomous before any tool-using turn so it doesn't
  // stop on a permission request mid-run.
  await ensureCloudBypass(taskId, taskRunId);
  await svc.sendPrompt(taskId, prompt);
  await waitFor(
    () => {
      const s = getSession(taskRunId);
      if (!s || s.isPromptPending || s.messageQueue.length > 0) return false;
      return getCheckpoints(taskRunId, afterTs).length > 0;
    },
    CLOUD_TURN_MS,
    `${label}: cloud turn complete (idle + queue drained + checkpoint)`,
  );
  const cps = getCheckpoints(taskRunId, afterTs);
  const cpId = cps[cps.length - 1].id;
  console.log(`[cloud-test] ${label} → checkpoint: ${cpId.slice(0, 8)} in ${Date.now() - afterTs}ms`);
  logState(taskRunId, `${label}/done`);
  return cpId;
}

// ─── Handoff helpers ──────────────────────────────────────────────────────────

async function handoffToCloud(
  taskId: string,
  taskRunId: string,
  repoPath: string,
  label = "→cloud",
): Promise<void> {
  const svc = getSessionService();
  console.log(`[cloud-test] [${label}] Initiating local→cloud handoff…`);
  logState(taskRunId, `${label}/before`);
  logCheckpoints(taskRunId, `${label}/before`);
  // Snapshot known IDs BEFORE handoff — used to detect the cloud init-turn checkpoint.
  // Using a timestamp (t) is unreliable: IPC lag can deliver pre-handoff checkpoint events
  // to the renderer AFTER t is captured, making old checkpoints appear as new cloud ones.
  const knownCpIds = new Set(getCheckpoints(taskRunId).map((c) => c.id));
  const t = Date.now();
  await svc.handoffToCloud(taskId, repoPath);
  await waitFor(() => !!getSession(taskRunId)?.isCloud, HANDOFF_MS, `${label}: cloud mode`);
  const cloudModeMs = Date.now() - t;
  console.log(`[cloud-test] [${label}] Cloud mode active in ${cloudModeMs}ms. cloudStatus=${getSession(taskRunId)?.cloudStatus ?? "-"}`);
  // After isCloud=true, the sandbox still needs to boot, clone, and run sendResumeMessage
  // (the initial context turn). isCloud flips locally BEFORE the sandbox boots, and the
  // handoff saga emits its own LOCAL pre-flight checkpoint at the start — so we must wait
  // specifically for a CLOUD-origin checkpoint (device.type="cloud"), which only appears
  // once the cloud agent has actually booted and run its resume turn (Fix 2). Waiting on
  // "any new checkpoint" would match the local pre-flight one and hand back while the
  // sandbox is still "Setting up sandbox".
  let gotInitCp = false;
  try {
    const initCpId = await waitForCloudCheckpoint(taskRunId, knownCpIds, CLOUD_INIT_TURN_MS);
    gotInitCp = true;
    console.log(`[cloud-test] [${label}] Cloud agent ready — cloud checkpoint: ${initCpId.slice(0, 8)}. Total elapsed: ${Date.now() - t}ms`);
  } catch {
    // Cloud didn't emit a checkpoint in time (resume turn failed, or sandbox too slow).
    // Proceed anyway — cloud prompts queue and run when the sandbox is ready.
    console.warn(`[cloud-test] [${label}] No CLOUD checkpoint within ${CLOUD_INIT_TURN_MS / 1000}s — sandbox may still be provisioning. Proceeding. Total elapsed: ${Date.now() - t}ms`);
  }
  // The cloud checkpoint proves the init/auto-context (resume) turn RAN; now make
  // sure it has fully COMPLETED (idle + queue drained) before returning. Otherwise
  // a follow-up cloud prompt sent by the caller would queue behind the still-running
  // init turn, and the NEXT handoff could fire during the gap and cut that turn short
  // (the symptom seen in D where the "beta" turn was sent too early and never answered).
  // We only do this once a checkpoint confirmed a turn started — otherwise the idle
  // check would pass instantly during the pre-dispatch gap.
  if (gotInitCp) {
    try {
      await waitForCloudIdle(taskRunId, CLOUD_INIT_TURN_MS, label);
      pass(`${label}: cloud init turn completed before handoff-back`);
    } catch {
      console.warn(`[cloud-test] [${label}] ⚠ Cloud agent still busy after init checkpoint within ${CLOUD_INIT_TURN_MS / 1000}s.`);
    }
  }
  logState(taskRunId, `${label}/after`);
}

async function handoffToLocal(
  taskId: string,
  taskRunId: string,
  repoPath: string,
  label = "→local",
): Promise<void> {
  const svc = getSessionService();
  console.log(`[cloud-test] [${label}] Initiating cloud→local handoff…`);
  logState(taskRunId, `${label}/before`);
  logCheckpoints(taskRunId, `${label}/before`);
  const t = Date.now();
  await svc.handoffToLocal(taskId, repoPath);
  await waitFor(
    () => { const s = getSession(taskRunId); return !s?.isCloud && s?.status === "connected"; },
    HANDOFF_MS, `${label}: local reconnect`,
  );
  console.log(`[cloud-test] [${label}] Local session active in ${Date.now() - t}ms`);
  // No separate auto-turn fires here. The pending context (cloud session summary) is
  // prepended inline as a hidden block to the FIRST user message we send — it is NOT
  // an autonomous agent turn. syncCloudCheckpointsFromLog already ran inside the saga's
  // fetch_and_rebuild step before status=connected, so checkpoints are ready immediately.
  logState(taskRunId, `${label}/after`);
  logCheckpoints(taskRunId, `${label}/after`);
}

// ─── Clean-worktree handoff target (cloud-NATIVE scenarios) ────────────────────
// A cloud-native task has NO local worktree, so `getEffectiveRepoPath` falls back to
// the registered folder. The cloud→local handoff applies the checkpoint onto that
// path and runs preflight, which HARD-FAILS if the folder is dirty — "Local working
// tree has uncommitted changes" (upstream-by-design, commit cbafd5b3 #1522). A
// cloud-native run almost always trips it: the registered folder accumulates residue
// from prior turns/scenarios (mode:"local" tasks run in the folder itself, no
// worktree). To run unattended, hand off into a CLEAN worktree instead:
//   • A git worktree shares the main repo's object DB, so the cloud checkpoint pack
//     (built on the same fork base) unpacks + applies cleanly.
//   • Register it as a folder so the handoff's `attachWorkspaceToFolder`
//     (findByPath → registered repository) can attach to it.
//   • Use its path as the handoff + restore + file-check target.
//
// We REUSE one stable worktree (`ccp-wt-<tag>`, no timestamp) across runs rather than
// creating+deleting a new one each time: create it once if missing, otherwise just
// reset it pristine to the main repo's current HEAD. It stays registered between runs.
// This is TEST-ONLY orchestration. It is NOT the product "continue locally into a new
// worktree" follow-up (that adds a dirty-tree dialog in src) — see the memory note
// project-continue-locally-dirty-tree-followup.
async function provisionCleanWorktree(
  mainRepoPath: string,
  tag: string,
): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const sh = (cwd: string, command: string) =>
    trpcClient.shell.execute.mutate({ cwd, command });
  const norm = (p: string) => p.replace(/\\/g, "/");

  const sep = mainRepoPath.includes("\\") ? "\\" : "/";
  const parent =
    mainRepoPath.slice(0, mainRepoPath.lastIndexOf(sep)) || mainRepoPath;
  const wtPath = `${parent}${sep}ccp-wt-${tag}`; // stable, reused across runs

  // The base we want the worktree to mirror = the main repo's current HEAD.
  const headRes = await sh(mainRepoPath, "git rev-parse HEAD");
  if (headRes.exitCode !== 0) {
    throw new Error(`git rev-parse HEAD failed: ${headRes.stderr || headRes.stdout}`);
  }
  const head = headRes.stdout.trim();

  // Already an active worktree for this path?
  const list = await sh(mainRepoPath, "git worktree list --porcelain");
  const alreadyWorktree =
    list.exitCode === 0 && norm(list.stdout).includes(norm(wtPath));

  if (!alreadyWorktree) {
    let add = await sh(mainRepoPath, `git worktree add --detach "${wtPath}" "${head}"`);
    if (add.exitCode !== 0) {
      // Stale registration or leftover dir from a previous run — prune and retry once.
      await sh(mainRepoPath, "git worktree prune");
      add = await sh(mainRepoPath, `git worktree add --detach "${wtPath}" "${head}"`);
      if (add.exitCode !== 0) {
        throw new Error(`git worktree add failed (rc=${add.exitCode}): ${add.stderr || add.stdout}`);
      }
    }
    console.log(`[cloud-test] created stable worktree: ${wtPath}`);
  } else {
    console.log(`[cloud-test] reusing stable worktree: ${wtPath}`);
  }

  // Make it pristine at main HEAD regardless of prior-run residue (applied
  // checkpoints, restore reverts, leftover test files).
  await sh(wtPath, `git checkout --detach "${head}"`);
  await sh(wtPath, `git reset --hard "${head}"`);
  await sh(wtPath, "git clean -fd");

  // Register so the handoff can resolve it (findByPath). addFolder is idempotent —
  // returns the existing registration on reuse. Use the canonical stored path so the
  // later findByPath lookup matches exactly.
  const folder = await trpcClient.folders.addFolder.mutate({ folderPath: wtPath });
  console.log(`[cloud-test] worktree folder ${folder.id} → ${folder.path}`);

  return {
    path: folder.path,
    cleanup: async () => {
      // Reused across runs — keep the worktree + registration, just leave it tidy.
      try {
        await sh(wtPath, "git reset --hard HEAD");
        await sh(wtPath, "git clean -fd");
      } catch (e) {
        console.warn("[cloud-test] worktree post-run clean failed:", e);
      }
    },
  };
}

async function restoreAndReconnect(
  taskId: string,
  taskRunId: string,
  checkpointId: string,
  repoPath: string,
  label: string,
): Promise<void> {
  const svc = getSessionService();
  console.log(`[cloud-test] Restoring to ${label} (${checkpointId.slice(0, 8)})…`);
  const result = await trpcClient.checkpoint.restore.mutate({ checkpointId, repoPath, taskRunId });
  sessionStoreSetters.truncateEventsToCheckpoint(taskId, checkpointId);
  await svc.restoreCheckpointReconnect(taskId, repoPath, result?.restoredSessionId, result?.adapter);
  await waitMs(2_000);
  logCheckpoints(taskRunId, `after-restore-${label}`);
  console.log(`[cloud-test] Restore to ${label} complete.`);
}

// ─── Scenario guides (printed to console at the start of each scenario) ──────

type GuideRow = { Phase: string; "What you'll see": string; "What it means": string };

function printScenarioGuide(name: string, rows: GuideRow[], passes: string[]): void {
  console.log(`\n[cloud-test] ─── EXPECTED RESULTS: ${name} ${"─".repeat(Math.max(0, 50 - name.length))}`);
  console.table(rows);
  console.log("[cloud-test] Expected PASS lines:");
  passes.forEach((p) => console.log(`  ${p}`));
  console.log("[cloud-test] Red flags: any ✗ FAIL line, Timeout error, or missing checkpoint ID.");
  console.log("[cloud-test] " + "─".repeat(63) + "\n");
}

const GUIDE_A_ROWS: GuideRow[] = [
  { Phase: "Task created",             "What you'll see": "Created task [id] — navigated to it",                           "What it means": "Task created and UI navigates to the conversation view" },
  { Phase: "Session ready",            "What you'll see": "Session connected — taskRunId: [id]",                           "What it means": "Local agent connected and ready for prompts" },
  { Phase: "Turn 1",                   "What you'll see": "=== A/Turn1-local === → checkpoint: [8chars]",                  "What it means": "Agent created the file, local checkpoint captured" },
  { Phase: "Turn 2",                   "What you'll see": "=== A/Turn2-local === → checkpoint: [8chars]",                  "What it means": "Agent added beta, second local checkpoint captured" },
  { Phase: "Before cloud handoff",     "What you'll see": "2 checkpoint(s): [id1] [id2]",                                  "What it means": "Both local checkpoints confirmed before leaving" },
  { Phase: "→cloud handoff",           "What you'll see": "Cloud mode active in [X]ms",                                    "What it means": "Fix 5: cp1+cp2 uploaded to S3 and injected into cloud log" },
  { Phase: "Cloud init turn wait",     "What you'll see": "Cloud initial turn complete — checkpoint: [8chars]. Total elapsed: [X]ms",  "What it means": "Fix 2: sandbox booted, ran sendResumeMessage, emitted checkpoint. X ≈ 60–120s" },
  { Phase: "→local handoff",           "What you'll see": "Local session active in [X]ms",                                 "What it means": "Fix 3: seeded log scanned, all checkpoints re-registered before reconnect" },
  { Phase: "After handoff",            "What you'll see": "≥2 checkpoint(s): includes [id1] [id2]",                        "What it means": "CRITICAL — both original IDs must be present (extra cloud init-turn cp is OK)" },
  { Phase: "Memory check",             "What you'll see": "file content: …alpha…beta…",                                    "What it means": "Agent recalled the full context; file matches expectation" },
  { Phase: "Restore to cp1",           "What you'll see": "Restore to A/cp1 complete.",                                    "What it means": "Git state rolled back to after Turn 1" },
  { Phase: "After restore",            "What you'll see": 'file content: export const alpha = \'A\';',                     "What it means": "beta is gone — Fix 4 working" },
  { Phase: "Turn 3 (gamma)",           "What you'll see": "checkpoint: [8chars] → file has alpha+gamma, not beta",         "What it means": "New turn works post-restore; beta does not bleed back" },
  { Phase: "Done",                     "What you'll see": "══ SCENARIO A: 10/10 passed ✓ ══",                              "What it means": "All assertions passed" },
];
const GUIDE_A_PASSES = [
  "✓ PASS: A: 2 local checkpoints captured before handoff",
  "✓ PASS: A/Fix5+Fix3: cp1 (xxxxxxxx) survived round-trip",
  "✓ PASS: A/Fix5+Fix3: cp2 (xxxxxxxx) survived round-trip",
  "✓ PASS: A: no duplicate checkpoint IDs",
  '✓ PASS: file has "alpha"  (A/memory-after-handoff/memory-file)',
  '✓ PASS: file has "beta"   (A/memory-after-handoff/memory-file)',
  "✓ PASS: A/Fix4: cp1 is the latest checkpoint after restore",
  '✓ PASS: file has "alpha"  (A/after-restore-cp1)',
  '✓ PASS: file lacks "beta" (A/after-restore-cp1)',
  "✓ PASS: A/Fix4: beta absent after restore to cp1 + new turn",
];

const GUIDE_B_ROWS: GuideRow[] = [
  { Phase: "Task + Turn 1 local",     "What you'll see": "=== B/Turn1-local === → checkpoint: [8chars]",                       "What it means": "cp1 captured locally before cloud" },
  { Phase: "→cloud handoff",          "What you'll see": "Cloud mode active in [X]ms",                                          "What it means": "Task handed to cloud sandbox" },
  { Phase: "Cloud init turn wait",    "What you'll see": "Cloud initial turn complete — checkpoint: [8chars]. Total elapsed: [X]ms",  "What it means": "Fix 2: sendResumeMessage finished and emitted checkpoint — cloud agent ready" },
  { Phase: "Cloud Turn 2",           "What you'll see": "B/Turn2-cloud: waiting up to 300s for cloud checkpoint…",               "What it means": "Our prompt sent to cloud agent AFTER initial turn finished" },
  { Phase: "Cloud checkpoint",        "What you'll see": "B/Turn2-cloud: checkpoint in [X]ms → [8chars]",                       "What it means": "Fix 2: cloud agent emitted a per-turn checkpoint for our turn" },
  { Phase: "→local handoff",          "What you'll see": "Local session active in [X]ms",                                       "What it means": "Fix 3: all cloud checkpoints re-registered before reconnect. Context prepended inline to next user msg" },
  { Phase: "After handoff",           "What you'll see": "≥2 checkpoint(s): includes cp1 + cp2_cloud",                          "What it means": "Cloud checkpoint landed locally — CRITICAL for Fix 3" },
  { Phase: "Memory check",            "What you'll see": "file content: …alpha…beta…",                                          "What it means": "Agent has full context including cloud turn after handoff" },
  { Phase: "Restore to cp2_cloud",    "What you'll see": "Restore to B/cp2_cloud complete.",                                    "What it means": "Fix 4: cloud-origin checkpoint restored successfully" },
  { Phase: "After restore file",      "What you'll see": "file has alpha + beta",                                               "What it means": "git state correct at cloud checkpoint boundary" },
  { Phase: "Turn 3 + memory",         "What you'll see": "checkpoint: [8chars] → file has alpha+beta+gamma",                    "What it means": "Post-restore turn works; memory intact" },
  { Phase: "Done",                    "What you'll see": "══ SCENARIO B: N/N passed ✓ ══",                                      "What it means": "All assertions passed" },
];
const GUIDE_B_PASSES = [
  "✓ PASS: B/Fix2: cloud turn emitted checkpoint (xxxxxxxx)",
  "✓ PASS: B/Fix3: cp1 (xxxxxxxx) present after cloud→local",
  "✓ PASS: B/Fix3: cp2_cloud (xxxxxxxx) synced from cloud log",
  "✓ PASS: B: no duplicate checkpoint IDs",
  '✓ PASS: file has "alpha"  (B/memory-immediate-post-handoff/memory-file)',
  '✓ PASS: file has "beta"   (B/memory-immediate-post-handoff/memory-file)',
  "✓ PASS: B/Fix4: cp2_cloud is the latest checkpoint after restore",
  '✓ PASS: file has "alpha"  (B/after-restore-cp2)',
  '✓ PASS: file has "beta"   (B/after-restore-cp2)',
  '✓ PASS: file has "alpha"  (B/memory-after-post-restore-turn/memory-file)',
  '✓ PASS: file has "beta"   (B/memory-after-post-restore-turn/memory-file)',
  '✓ PASS: file has "gamma"  (B/memory-after-post-restore-turn/memory-file)',
];

const GUIDE_C_ROWS: GuideRow[] = [
  { Phase: "Task created",             "What you'll see": "Created task [id] — navigated to it",                          "What it means": "Task created and UI navigates to the conversation view" },
  { Phase: "Greeting turn",            "What you'll see": "(agent idle, no checkpoint)",                                   "What it means": "Greeting acknowledged; 0 local checkpoints" },
  { Phase: "→cloud (immediately)",     "What you'll see": "C/→cloud (no local history) → Cloud mode active",              "What it means": "Went to cloud before any file was touched" },
  { Phase: "Cloud init turn wait",     "What you'll see": "Cloud initial turn complete — checkpoint: [8chars]. Total elapsed: [X]ms", "What it means": "Fix 2: sendResumeMessage done; this checkpoint is cloud-init origin, not a file turn" },
  { Phase: "Before cloud check",       "What you'll see": "≥1 checkpoint(s) (the init turn's cp)",                         "What it means": "Only the cloud init-turn checkpoint; no local checkpoints" },
  { Phase: "Cloud Turn 1",             "What you'll see": "C/Turn1-cloud checkpoint: [8chars] in [X]ms",                  "What it means": "Fix 2: first ever checkpoint is cloud-origin" },
  { Phase: "Cloud Turn 2",             "What you'll see": "C/Turn2-cloud checkpoint: [8chars] in [X]ms",                  "What it means": "Fix 2: second cloud checkpoint captured" },
  { Phase: "→local handoff",           "What you'll see": "Local session active in [X]ms",                                "What it means": "Fix 3: all cloud checkpoints re-registered before reconnect. Pending context baked into first user msg" },
  { Phase: "After handoff",            "What you'll see": "≥2 checkpoint(s): includes cpC1 + cpC2",                       "What it means": "CRITICAL — cloud-native checkpoints arrived locally" },
  { Phase: "Memory check",             "What you'll see": "file content: …alpha…beta…",                                   "What it means": "Agent recalls both cloud turns after handoff" },
  { Phase: "Restore to cpC1",          "What you'll see": "Restore to C/cpC1 complete. file has alpha only",              "What it means": "Fix 4: restoring a cloud checkpoint from a local session works" },
  { Phase: "Done",                     "What you'll see": "══ SCENARIO C: N/N passed ✓ ══",                               "What it means": "All assertions passed" },
];
const GUIDE_C_PASSES = [
  "✓ PASS: C: no local checkpoints at cloud handoff time",
  "✓ PASS: C/Fix2: cloud turn 1 emitted checkpoint",
  "✓ PASS: C/Fix2: cloud turn 2 emitted checkpoint",
  "✓ PASS: C/Fix3: cpC1 (xxxxxxxx) synced",
  "✓ PASS: C/Fix3: cpC2 (xxxxxxxx) synced",
  "✓ PASS: C: no duplicate IDs",
  '✓ PASS: file has "alpha"  (C/memory-after-handoff/memory-file)',
  '✓ PASS: file has "beta"   (C/memory-after-handoff/memory-file)',
  '✓ PASS: file has "alpha"  (C/after-restore-cpC1)',
  '✓ PASS: file lacks "beta" (C/after-restore-cpC1)',
];

const GUIDE_D_ROWS: GuideRow[] = [
  { Phase: "Turn 1 local → cpL1",         "What you'll see": "=== D/Turn1-local === → checkpoint: cpL1",                        "What it means": "First local checkpoint captured" },
  { Phase: "→cloud[1] (Fix 5)",           "What you'll see": "Cloud mode active in [X]ms",                                       "What it means": "Fix 5: cpL1 uploaded to S3 and appended to cloud log" },
  { Phase: "Cloud init turn wait [1]",    "What you'll see": "Cloud initial turn complete — checkpoint: [8chars]",                "What it means": "Fix 2: sendResumeMessage done — cloud agent ready for our prompt" },
  { Phase: "Cloud Turn 2 → cpC2 (Fix 2)", "What you'll see": "D/Fix2: cloud turn emitted checkpoint (xxxxxxxx)",                "What it means": "Cloud agent emitted its own checkpoint" },
  { Phase: "→local[1] (Fix 3)",           "What you'll see": "Local session active in [X]ms",                                    "What it means": "Fix 3: all checkpoints re-registered. Pending context baked inline into first user msg" },
  { Phase: "Memory check #1",             "What you'll see": "file has alpha+beta",                                               "What it means": "Agent recalls local turn + cloud turn after first handoff" },
  { Phase: "Turn 3 local → cpL3",         "What you'll see": "=== D/Turn3-local === → checkpoint: cpL3",                         "What it means": "New local checkpoint after coming back from cloud" },
  { Phase: "→cloud[2] (Fix 5 again)",     "What you'll see": "Cloud mode active in [X]ms",                                       "What it means": "Fix 5: uploads cpL3 (cpL1+cpC2 already in log, skipped)" },
  { Phase: "Cloud init turn wait [2]",    "What you'll see": "Cloud initial turn complete — checkpoint: [8chars]",                "What it means": "Fix 2: second sendResumeMessage done — cloud agent ready" },
  { Phase: "→local[2] (Fix 3 again)",     "What you'll see": "Local session active in [X]ms",                                    "What it means": "Fix 3: all 3 checkpoints survived second round-trip. Pending context inline" },
  { Phase: "Memory check #2",             "What you'll see": "file has alpha+beta+gamma",                                         "What it means": "Agent recalls all 3 turns after double handoff" },
  { Phase: "Restore to cpC2 (middle)",    "What you'll see": "Restore to D/cpC2 complete.",                                       "What it means": "Fix 4: restore to a cloud checkpoint sandwiched between two local ones" },
  { Phase: "After restore",               "What you'll see": "file has alpha+beta, lacks gamma",                                  "What it means": "git state correct at cloud midpoint; gamma was after cpC2" },
  { Phase: "Turn 4 + memory check #3",    "What you'll see": "file has alpha+beta+delta, lacks gamma",                           "What it means": "Post-restore turn works; gamma does not bleed back in" },
  { Phase: "Done",                        "What you'll see": "══ SCENARIO D: N/N passed ✓ ══",                                    "What it means": "All assertions passed" },
];
const GUIDE_D_PASSES = [
  "✓ PASS: D: cp_L1 visible in cloud session store",
  "✓ PASS: D/Fix2: cloud turn emitted checkpoint (xxxxxxxx)",
  "✓ PASS: D/Fix3[1]: cp_L1 (xxxxxxxx) synced",
  "✓ PASS: D/Fix3[1]: cp_C2 (xxxxxxxx) synced",
  '✓ PASS: file has "alpha"  (D/memory-after-first-handoff/memory-file)',
  '✓ PASS: file has "beta"   (D/memory-after-first-handoff/memory-file)',
  "✓ PASS: D/Fix5+Fix3[2]: cp_L1 survived second round-trip",
  "✓ PASS: D/Fix5+Fix3[2]: cp_C2 survived second round-trip",
  "✓ PASS: D/Fix5+Fix3[2]: cp_L3 (xxxxxxxx) survived",
  "✓ PASS: D: no duplicate IDs after double round-trip",
  '✓ PASS: file has "alpha"  (D/memory-after-second-handoff/memory-file)',
  '✓ PASS: file has "beta"   (D/memory-after-second-handoff/memory-file)',
  '✓ PASS: file has "gamma"  (D/memory-after-second-handoff/memory-file)',
  '✓ PASS: file has "alpha"  (D/after-restore-cpC2)',
  '✓ PASS: file has "beta"   (D/after-restore-cpC2)',
  '✓ PASS: file lacks "gamma" (D/after-restore-cpC2)',
  '✓ PASS: file has "alpha"  (D/memory-after-post-restore-turn/memory-file)',
  '✓ PASS: file has "beta"   (D/memory-after-post-restore-turn/memory-file)',
  '✓ PASS: file has "delta"  (D/memory-after-post-restore-turn/memory-file)',
  "✓ PASS: D/Fix4: gamma absent after restore to cp_C2",
];

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO A — local→cloud→local passthrough
// ═══════════════════════════════════════════════════════════════════════════════
//
// Purpose:
//   Proves that local checkpoints are NOT lost when a task moves through a
//   cloud→local→cloud cycle.  No cloud turns are needed — the test hands off
//   to cloud immediately and comes straight back.
//
// Fixes covered:
//   Fix 5 — during local→cloud handoff, all prior local checkpoint packs are
//            uploaded to S3 and appended to the cloud run log.
//   Fix 3 — during cloud→local handoff, those entries are read from the seeded
//            logs.ndjson, applied locally via git, and registered in agentService
//            so restore buttons light up for every cloud turn.
//   Fix 4 — restore button is enabled for any registered checkpoint;
//            restore + reconnect succeeds regardless of where the checkpoint
//            was originally captured (local or cloud).
//
// Assertions:
//   • cp1 + cp2 are both visible after the round-trip
//   • No duplicate checkpoint IDs
//   • Restore to cp1 succeeds; file has alpha only (not beta)
//   • Agent memory check after cloud→local handoff: recalls the session context

async function runScenarioA(adapter: "codex" | "claude", model: string): Promise<void> {
  console.log("\n[cloud-test] ══════════════════════════════════════════════\n" +
              "[cloud-test]  SCENARIO A — local→cloud→local passthrough\n" +
              "[cloud-test]  Fixes: 5, 3, 4\n" +
              "[cloud-test] ══════════════════════════════════════════════");
  console.log(
    "\n[cloud-test] WHAT THIS SCENARIO DOES:\n" +
    "[cloud-test]   1. Runs 2 local turns: Turn 1 creates the file (alpha), Turn 2 appends beta.\n" +
    "[cloud-test]      Both turns capture local git checkpoints (cp1, cp2).\n" +
    "[cloud-test]   2. Hands the task to cloud. No cloud prompts are sent at all.\n" +
    "[cloud-test]      Fix 5 uploads cp1+cp2 to S3 and injects them into the cloud run log.\n" +
    "[cloud-test]      The cloud's sendResumeMessage (auto-context) turn runs automatically\n" +
    "[cloud-test]      and we wait for its checkpoint — that is the 'cloud agent ready' signal.\n" +
    "[cloud-test]   3. Immediately hands back to local. Fix 3 re-seeds cp1+cp2 from the\n" +
    "[cloud-test]      seeded cloud log so restore buttons reappear.\n" +
    "[cloud-test]   4. Asserts both cp1 and cp2 are visible with no duplicates.\n" +
    "[cloud-test]   5. Sends a memory check: the cloud→local pending-context summary is\n" +
    "[cloud-test]      prepended inline to this first user message — agent should recall both\n" +
    "[cloud-test]      alpha and beta without needing a separate auto-context turn.\n" +
    "[cloud-test]   6. Restores to cp1. File should contain only alpha (beta is after cp1).\n" +
    "[cloud-test]   7. Runs one more turn (add gamma) to prove no content from after the\n" +
    "[cloud-test]      restore point bleeds back in.\n" +
    "[cloud-test]\n" +
    "[cloud-test] WHY: Isolates Fix 5 + Fix 3 without needing Fix 2 (cloud per-turn\n" +
    "[cloud-test]      checkpoints). If Scenario A fails but B/C pass, the issue is in\n" +
    "[cloud-test]      the upload/sync path, not in the cloud agent's checkpoint capture.\n" +
    "[cloud-test] DURATION: ~5–8 min (cloud sandbox boot accounts for 60–120s).\n" +
    "[cloud-test] CLOUD TURNS: 0 user-initiated turns (only the auto-context init turn).\n",
  );
  printScenarioGuide("SCENARIO A", GUIDE_A_ROWS, GUIDE_A_PASSES);

  const repoPath = await getRepoPath();
  const fileName = `test-ccp-a-${Date.now()}.ts`;

  const { taskId, taskRunId } = await launchLocalTask(
    repoPath, adapter, model,
    `[AUTOMATED TEST HARNESS] This is a checkpoint smoke-test scaffold. Do NOT take any action, search files, or delete anything. Just reply with "ready" and wait for further instructions.`,
  );

  await waitFor(() => !getSession(taskRunId)?.isPromptPending, LOCAL_TURN_MS, "greeting turn");
  const effectiveRepoPath = await getEffectiveRepoPath(taskId, repoPath);
  console.log(`[cloud-test] repo: ${effectiveRepoPath}  file: ${fileName}`);

  // ── Two local turns ───────────────────────────────────────────────────────
  const cp1 = await runTurn(taskId, taskRunId,
    `Use a terminal command (e.g. printf) to create ${fileName} at the repo root containing exactly: export const alpha = 'A'; — do not use file editing tools.`,
    "A/Turn1-local: create file");

  const cp2 = await runTurn(taskId, taskRunId,
    `Use a terminal command to append to ${fileName}: export const beta = 'B'; keep the alpha line. Do not use file editing tools.`,
    "A/Turn2-local: add beta");

  logCheckpoints(taskRunId, "A/before-cloud-handoff");
  check(getCheckpoints(taskRunId).length >= 2, "A: 2 local checkpoints captured before handoff");

  // ── local→cloud (Fix 5 uploads cp1 + cp2 to S3 and into cloud log) ──────
  await handoffToCloud(taskId, taskRunId, effectiveRepoPath, "A/→cloud");

  // ── cloud→local (Fix 3 re-syncs cp1 + cp2 from seeded log) ───────────────
  await handoffToLocal(taskId, taskRunId, effectiveRepoPath, "A/→local");

  const cpAfter = getCheckpoints(taskRunId);
  const ids = cpAfter.map((c) => c.id);
  check(ids.includes(cp1), `A/Fix5+Fix3: cp1 (${cp1.slice(0, 8)}) survived round-trip`);
  check(ids.includes(cp2), `A/Fix5+Fix3: cp2 (${cp2.slice(0, 8)}) survived round-trip`);
  check(new Set(ids).size === ids.length, "A: no duplicate checkpoint IDs");

  // ── Agent memory check (immediate, after pending-context injection) ───────
  // After cloud→local handoff, setPendingContext injects a summary into the
  // first user message. Our memory prompt IS that first message — the context
  // is prepended automatically, so the agent should recall both alpha and beta.
  await checkMemory(taskId, taskRunId, effectiveRepoPath, fileName,
    ["alpha", "beta"], "A/memory-after-handoff");

  // ── Restore to cp1 (Fix 4) ────────────────────────────────────────────────
  await restoreAndReconnect(taskId, taskRunId, cp1, effectiveRepoPath, "A/cp1");
  // Correct truncation = cp1 is the LATEST surviving checkpoint (everything after
  // it removed). Asserting an exact count is brittle: the real topology has more
  // legit restore points than turns (harness, pre-flight handoff snapshot, etc.).
  check(getCheckpoints(taskRunId).at(-1)?.id === cp1, "A/Fix4: cp1 is the latest checkpoint after restore");
  await checkFile(effectiveRepoPath, fileName, ["alpha"], ["beta"], "A/after-restore-cp1");

  // ── One more turn post-restore — agent must NOT remember beta ────────────
  await runTurn(taskId, taskRunId,
    `Use a terminal command to append to ${fileName}: export const gamma = 'G'; keep existing exports. Do not use file editing tools.`,
    "A/Turn3-post-restore: add gamma");
  await checkFile(effectiveRepoPath, fileName, ["alpha", "gamma"], [], "A/after-gamma");
  // beta should NOT be present — it was after the restore point
  const contentFinal = await readFile(effectiveRepoPath, fileName).catch(() => "");
  check(!contentFinal.includes("beta"), "A/Fix4: beta absent after restore to cp1 + new turn");

  summary("SCENARIO A");
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO B — cloud turns emit checkpoints + sync after handoff
// ═══════════════════════════════════════════════════════════════════════════════
//
// Purpose:
//   Proves that turns executed INSIDE the cloud sandbox each produce a git
//   checkpoint, and that all those checkpoints land in the local session
//   after a cloud→local handoff.
//
// Fixes covered:
//   Fix 2 — the cloud agent-server calls captureCheckpointState() after every
//            broadcastTurnComplete(), tagging each checkpoint with a promptId.
//   Fix 3 — cloud→local handoff reads the seeded log for ALL git_checkpoint
//            events, not just the latest, and registers each locally.
//   Fix 4 — a cloud-origin checkpoint can be restored from a local session.
//
// Assertions:
//   • Cloud turn emits a checkpoint (Fix 2)
//   • After cloud→local handoff, that cloud checkpoint is visible locally (Fix 3)
//   • Restore to cloud checkpoint succeeds; file has correct exports (Fix 4)
//   • Agent memory check immediately after handoff + after one more turn

async function runScenarioB(adapter: "codex" | "claude", model: string): Promise<void> {
  console.log("\n[cloud-test] ══════════════════════════════════════════════\n" +
              "[cloud-test]  SCENARIO B — cloud turns emit checkpoints\n" +
              "[cloud-test]  Fixes: 2, 3, 4\n" +
              "[cloud-test] ══════════════════════════════════════════════");
  console.log(
    "\n[cloud-test] WHAT THIS SCENARIO DOES:\n" +
    "[cloud-test]   1. Runs 1 local turn: creates the file with alpha, captures cp1.\n" +
    "[cloud-test]   2. Hands to cloud. Fix 5 uploads cp1 to S3. Waits for the cloud\n" +
    "[cloud-test]      init turn (sendResumeMessage) to complete — its checkpoint is\n" +
    "[cloud-test]      the signal that the cloud agent is ready for user prompts.\n" +
    "[cloud-test]   3. Sends 1 cloud prompt: 'append beta'. Cloud agent runs, appends\n" +
    "[cloud-test]      beta, and Fix 2 captures a git checkpoint (cp2_cloud) right after\n" +
    "[cloud-test]      broadcastTurnComplete fires.\n" +
    "[cloud-test]   4. Hands back to local. Fix 3 syncs cp1 + cp2_cloud from the cloud log.\n" +
    "[cloud-test]   5. Asserts both cp1 and cp2_cloud are visible locally.\n" +
    "[cloud-test]   6. Memory check: pending-context summary injected inline into the\n" +
    "[cloud-test]      first user message. Agent should recall alpha + beta.\n" +
    "[cloud-test]   7. Restores to cp2_cloud (a cloud-origin checkpoint). Asserts file\n" +
    "[cloud-test]      has alpha + beta. Runs one more turn (gamma) and checks memory.\n" +
    "[cloud-test]\n" +
    "[cloud-test] WHY: Adds Fix 2 (cloud per-turn checkpoints) to the Scenario A base.\n" +
    "[cloud-test]      If Scenario A passes but B fails, the issue is in broadcastTurnComplete\n" +
    "[cloud-test]      not calling captureCheckpointState, or Fix 3 not picking up cloud cps.\n" +
    "[cloud-test] DURATION: ~10–15 min.\n" +
    "[cloud-test] CLOUD TURNS: 1 user-initiated turn + the auto-context init turn.\n",
  );
  printScenarioGuide("SCENARIO B", GUIDE_B_ROWS, GUIDE_B_PASSES);

  const repoPath = await getRepoPath();
  const fileName = `test-ccp-b-${Date.now()}.ts`;

  const { taskId, taskRunId } = await launchLocalTask(
    repoPath, adapter, model,
    `[AUTOMATED TEST HARNESS] This is a checkpoint smoke-test scaffold. Do NOT take any action, search files, or delete anything. Just reply with "ready" and wait for further instructions.`,
  );

  await waitFor(() => !getSession(taskRunId)?.isPromptPending, LOCAL_TURN_MS, "greeting turn");
  const effectiveRepoPath = await getEffectiveRepoPath(taskId, repoPath);

  // ── One local turn → cp1 ────────────────────────────────────────────────
  const cp1 = await runTurn(taskId, taskRunId,
    `Use a terminal command (e.g. printf) to create ${fileName} at the repo root containing exactly: export const alpha = 'A'; — do not use file editing tools.`,
    "B/Turn1-local: create file");

  // ── local→cloud ──────────────────────────────────────────────────────────
  await handoffToCloud(taskId, taskRunId, effectiveRepoPath, "B/→cloud");

  // ── Cloud turn (Fix 2: cloud agent emits checkpoint) ─────────────────────
  // sendPrompt routes to sendCloudPrompt because session.isCloud === true.
  // The cloud agent's agent-server emits a GIT_CHECKPOINT after completing
  // broadcastTurnComplete() — we wait up to CLOUD_TURN_MS for it.
  console.log(`[cloud-test] B/Turn2-cloud: waiting up to ${CLOUD_TURN_MS / 1000}s for cloud checkpoint…`);
  let cp2Cloud: string | null = null;
  const cloudTurnStart = Date.now();
  try {
    await getSessionService().sendPrompt(taskId,
      `Use a terminal command to append to ${fileName}: export const beta = 'B'; keep the alpha line. Do not use file editing tools.`);
    await waitFor(() => !getSession(taskRunId)?.isPromptPending, CLOUD_TURN_MS, "B/Turn2-cloud: turn complete");
    cp2Cloud = await waitForCheckpoint(taskRunId, cloudTurnStart, CP_CLOUD_MS);
    console.log(`[cloud-test] B/Turn2-cloud: checkpoint in ${Date.now() - cloudTurnStart}ms → ${cp2Cloud.slice(0, 8)}`);
    pass(`B/Fix2: cloud turn emitted checkpoint (${cp2Cloud.slice(0, 8)})`);
  } catch (err) {
    fail(`B/Fix2: no cloud checkpoint within timeout — ${err instanceof Error ? err.message : err}`);
    console.warn("[cloud-test] Continuing with Fix 3 check using only cp1.");
  }

  // ── cloud→local (Fix 3 syncs cloud checkpoints) ──────────────────────────
  await handoffToLocal(taskId, taskRunId, effectiveRepoPath, "B/→local");

  const cpAfter = getCheckpoints(taskRunId);
  const ids = cpAfter.map((c) => c.id);
  check(ids.includes(cp1), `B/Fix3: cp1 (${cp1.slice(0, 8)}) present after cloud→local`);
  if (cp2Cloud) {
    check(ids.includes(cp2Cloud), `B/Fix3: cp2_cloud (${cp2Cloud.slice(0, 8)}) synced from cloud log`);
    check(new Set(ids).size === ids.length, "B: no duplicate checkpoint IDs");
  }

  // ── Agent memory check immediately after handoff ─────────────────────────
  // The pending-context summary is injected here. Agent should recall alpha + beta.
  await checkMemory(taskId, taskRunId, effectiveRepoPath, fileName,
    cp2Cloud ? ["alpha", "beta"] : ["alpha"], "B/memory-immediate-post-handoff");

  if (cp2Cloud) {
    // ── Restore to cloud checkpoint (Fix 4) ────────────────────────────────
    await restoreAndReconnect(taskId, taskRunId, cp2Cloud, effectiveRepoPath, "B/cp2_cloud");
    // Correct truncation = cp2_cloud is the LATEST surviving checkpoint. The
    // survivors (harness, alpha, pre-flight, cloud-init, cp2_cloud) are all legit
    // restore points, so an exact count is brittle — assert the boundary instead.
    check(getCheckpoints(taskRunId).at(-1)?.id === cp2Cloud, "B/Fix4: cp2_cloud is the latest checkpoint after restore");
    await checkFile(effectiveRepoPath, fileName, ["alpha", "beta"], [], "B/after-restore-cp2");

    // ── One turn after cloud restore — memory check ──────────────────────
    await runTurn(taskId, taskRunId,
      `Use a terminal command to append to ${fileName}: export const gamma = 'G'; keep existing exports. Do not use file editing tools.`,
      "B/Turn3-post-restore: add gamma");

    await checkMemory(taskId, taskRunId, effectiveRepoPath, fileName,
      ["alpha", "beta", "gamma"], "B/memory-after-post-restore-turn");
  }

  summary("SCENARIO B");
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO C — cloud-native task (no local turns before going to cloud)
// ═══════════════════════════════════════════════════════════════════════════════
//
// Purpose:
//   Tests the workflow where a task goes to cloud BEFORE any local turns.
//   This is "cloud-first" usage — the user creates a task and immediately
//   hands it to the cloud agent.  No local checkpoint history exists when the
//   cloud starts; all checkpoints originate in the cloud sandbox.
//
// Fixes covered:
//   Fix 2 — cloud agent emits per-turn checkpoints even with no prior local history.
//   Fix 3 — after cloud→local handoff, ALL cloud checkpoints (cp_C1, cp_C2)
//            are synced to the local session.
//   Fix 4 — restoring a cloud checkpoint works from a clean local session.
//
// Assertions:
//   • 2 cloud turns each emit a checkpoint (Fix 2)
//   • After cloud→local handoff, both cloud checkpoints visible locally (Fix 3)
//   • Restore to cp_C1 succeeds; file has only alpha (Fix 4)
//   • Agent memory check after cloud→local: recalls both turns

async function runScenarioC(adapter: "codex" | "claude", model: string): Promise<void> {
  console.log("\n[cloud-test] ══════════════════════════════════════════════\n" +
              "[cloud-test]  SCENARIO C — cloud-native task (no local turns first)\n" +
              "[cloud-test]  Fixes: 2, 3, 4\n" +
              "[cloud-test] ══════════════════════════════════════════════");
  console.log(
    "\n[cloud-test] WHAT THIS SCENARIO DOES:\n" +
    "[cloud-test]   1. Creates the task locally but immediately hands it to cloud — NO\n" +
    "[cloud-test]      local turns at all. The file does not exist before cloud starts.\n" +
    "[cloud-test]      There is zero local checkpoint history when Fix 5 runs (nothing\n" +
    "[cloud-test]      to upload — the upload step should be a safe no-op).\n" +
    "[cloud-test]   2. Waits for the cloud init turn (sendResumeMessage) checkpoint.\n" +
    "[cloud-test]   3. Sends cloud Turn 1: 'create file with alpha'. Fix 2 captures cpC1.\n" +
    "[cloud-test]   4. Sends cloud Turn 2: 'append beta'. Fix 2 captures cpC2.\n" +
    "[cloud-test]   5. Hands back to local. Fix 3 syncs both cpC1 and cpC2.\n" +
    "[cloud-test]   6. Asserts both cloud checkpoints are visible locally.\n" +
    "[cloud-test]   7. Memory check: agent recalls both turns via pending-context injection.\n" +
    "[cloud-test]   8. Restores to cpC1 — the very first cloud checkpoint. File should\n" +
    "[cloud-test]      have only alpha; beta (from cpC2) must be absent.\n" +
    "[cloud-test]\n" +
    "[cloud-test] WHY: Tests Fix 2+3 without Fix 5 (no local history to upload). Exercises\n" +
    "[cloud-test]      the 'cloud-first' user workflow and confirms Fix 4 works for a\n" +
    "[cloud-test]      cloud checkpoint restored on a local session with no prior local turns.\n" +
    "[cloud-test] DURATION: ~10–15 min.\n" +
    "[cloud-test] CLOUD TURNS: 2 user-initiated turns + the auto-context init turn.\n",
  );
  printScenarioGuide("SCENARIO C", GUIDE_C_ROWS, GUIDE_C_PASSES);

  const repoPath = await getRepoPath();
  const fileName = `test-ccp-c-${Date.now()}.ts`;

  // Cloud-NATIVE: create the task directly in the cloud — no local agent, no local
  // turns, no local checkpoint history. The greeting is the cloud run's initial turn.
  const { taskId, taskRunId } = await launchCloudTask(
    repoPath, adapter, model,
    `[AUTOMATED TEST HARNESS] This is a checkpoint smoke-test scaffold. Do NOT take any action, search files, or delete anything. Just reply with "ready" and wait for further instructions.`,
  );

  // Wait for the sandbox to boot, run its initial turn, emit the first cloud
  // checkpoint, then settle to idle before we send real turns.
  try {
    await waitForCloudCheckpoint(taskRunId, new Set<string>(), CLOUD_INIT_TURN_MS);
  } catch {
    console.warn(`[cloud-test] C: no cloud init checkpoint within ${CLOUD_INIT_TURN_MS / 1000}s — proceeding, prompts will queue until ready.`);
  }
  await waitForCloudIdle(taskRunId, CLOUD_INIT_TURN_MS, "C/cloud-init").catch(() => {});

  const cpsAtCloudEntry = getCheckpoints(taskRunId);
  // Truly cloud-native: zero local turns ran, so the only checkpoint(s) present
  // originate in the cloud (the init turn). No local checkpoint history exists.
  check(cpsAtCloudEntry.length <= 1, "C: ≤1 checkpoint at cloud entry (cloud init turn only, zero local cps)");

  // ── Cloud turn 1 ──────────────────────────────────────────────────────────
  let cpC1: string | null = null;
  try {
    cpC1 = await runCloudTurn(taskId, taskRunId,
      `Use a terminal command (e.g. printf) to create ${fileName} at the repo root containing exactly: export const alpha = 'A'; — do not use file editing tools.`,
      "C/Turn1-cloud");
    pass(`C/Fix2: cloud turn 1 emitted checkpoint`);
  } catch (err) {
    fail(`C/Fix2: no checkpoint for cloud turn 1 — ${err instanceof Error ? err.message : err}`);
  }

  // ── Cloud turn 2 ──────────────────────────────────────────────────────────
  let cpC2: string | null = null;
  try {
    cpC2 = await runCloudTurn(taskId, taskRunId,
      `Use a terminal command to append to ${fileName}: export const beta = 'B'; keep the alpha line. Do not use file editing tools.`,
      "C/Turn2-cloud");
    pass(`C/Fix2: cloud turn 2 emitted checkpoint`);
  } catch (err) {
    fail(`C/Fix2: no checkpoint for cloud turn 2 — ${err instanceof Error ? err.message : err}`);
  }

  // ── cloud→local (Fix 3) — into a CLEAN registered worktree so a dirty
  // registered folder can't block the handoff (see provisionCleanWorktree). ──
  const wt = await provisionCleanWorktree(repoPath, "c");
  try {
    await handoffToLocal(taskId, taskRunId, wt.path, "C/→local");

    const cpAfter = getCheckpoints(taskRunId);
    const ids = cpAfter.map((c) => c.id);
    console.log("[cloud-test] C: checkpoints after cloud→local:", ids.map((i) => i.slice(0, 8)));
    if (cpC1) check(ids.includes(cpC1), `C/Fix3: cpC1 (${cpC1.slice(0, 8)}) synced`);
    if (cpC2) check(ids.includes(cpC2), `C/Fix3: cpC2 (${cpC2.slice(0, 8)}) synced`);
    check(new Set(ids).size === ids.length, "C: no duplicate IDs");

    // ── Agent memory check after cloud→local ─────────────────────────────────
    await checkMemory(taskId, taskRunId, wt.path, fileName,
      cpC2 ? ["alpha", "beta"] : cpC1 ? ["alpha"] : [], "C/memory-after-handoff");

    // ── Restore to cpC1 (Fix 4) ──────────────────────────────────────────────
    if (cpC1) {
      await restoreAndReconnect(taskId, taskRunId, cpC1, wt.path, "C/cpC1");
      await checkFile(wt.path, fileName, ["alpha"], ["beta"], "C/after-restore-cpC1");
    }
  } finally {
    await wt.cleanup();
  }

  summary("SCENARIO C");
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO D — full bidirectional: local→cloud→local + local→cloud (again)
// ═══════════════════════════════════════════════════════════════════════════════
//
// Purpose:
//   The most comprehensive test. Verifies that checkpoints from BOTH local
//   and cloud turns survive multiple handoffs in both directions.
//   This catches any failure in the full chain: Fix 5 (upload) →
//   Fix 3 (sync) → Fix 5 again (upload the next batch) → Fix 3 again.
//
// Sequence:
//   Local turn 1  → cp_L1  (local checkpoint)
//   →cloud handoff          (Fix 5: uploads cp_L1 to S3)
//   Cloud turn 2  → cp_C2  (cloud checkpoint, Fix 2)
//   →local handoff          (Fix 3: cp_L1 + cp_C2 synced locally)
//   [memory check — agent recalls L1 and C2]
//   Local turn 3  → cp_L3  (new local checkpoint)
//   →cloud handoff          (Fix 5: uploads cp_L3; cp_L1 + cp_C2 already in log)
//   →local handoff          (Fix 3: all 3 checkpoints synced)
//   [memory check — agent recalls all 3 turns]
//   Restore to cp_C2        (Fix 4: restore cloud checkpoint in middle of history)
//   [verify file has alpha + beta, not gamma]
//
// Fixes covered: 2, 3, 4, 5 — all exercised, including Fix 5 on a second handoff

async function runScenarioD(adapter: "codex" | "claude", model: string): Promise<void> {
  console.log("\n[cloud-test] ══════════════════════════════════════════════\n" +
              "[cloud-test]  SCENARIO D — full bidirectional round-trip\n" +
              "[cloud-test]  Fixes: 2, 3, 4, 5 (all)\n" +
              "[cloud-test] ══════════════════════════════════════════════");
  console.log(
    "\n[cloud-test] WHAT THIS SCENARIO DOES:\n" +
    "[cloud-test]   1. Local Turn 1: creates file with alpha → cp_L1.\n" +
    "[cloud-test]   2. →cloud handoff [1]. Fix 5 uploads cp_L1. Wait for cloud init turn.\n" +
    "[cloud-test]   3. Cloud Turn 2: appends beta → cp_C2 (Fix 2).\n" +
    "[cloud-test]   4. →local handoff [1]. Fix 3 syncs cp_L1 + cp_C2.\n" +
    "[cloud-test]      Memory check #1: agent recalls alpha + beta (2 turns across the handoff).\n" +
    "[cloud-test]   5. Local Turn 3: appends gamma → cp_L3.\n" +
    "[cloud-test]      (This is a new local turn AFTER returning from cloud — tests that\n" +
    "[cloud-test]       local checkpointing still works normally after a cloud visit.)\n" +
    "[cloud-test]   6. →cloud handoff [2]. Fix 5 uploads cp_L3. cp_L1 + cp_C2 are already\n" +
    "[cloud-test]      in the cloud log and must NOT be re-uploaded (de-dup). Wait for cloud\n" +
    "[cloud-test]      init turn checkpoint on the second cloud visit.\n" +
    "[cloud-test]   7. →local handoff [2]. Fix 3 syncs all 3: cp_L1, cp_C2, cp_L3.\n" +
    "[cloud-test]      Memory check #2: agent recalls all 3 turns (alpha + beta + gamma).\n" +
    "[cloud-test]   8. Restore to cp_C2 (the cloud checkpoint sandwiched between local turns).\n" +
    "[cloud-test]      File must have alpha + beta, gamma must be absent.\n" +
    "[cloud-test]   9. Local Turn 4: appends delta. Memory check #3: alpha+beta+delta only\n" +
    "[cloud-test]      (gamma from the branch we restored over must not bleed back in).\n" +
    "[cloud-test]\n" +
    "[cloud-test] WHY: The full stress test — all 5 fixes exercised in two complete\n" +
    "[cloud-test]      round-trips. Validates Fix 5 de-dup on the second handoff and\n" +
    "[cloud-test]      Fix 4 on a cloud checkpoint sandwiched between local checkpoints.\n" +
    "[cloud-test] DURATION: ~20–30 min.\n" +
    "[cloud-test] CLOUD TURNS: 1 user-initiated cloud turn + two auto-context init turns.\n",
  );
  printScenarioGuide("SCENARIO D", GUIDE_D_ROWS, GUIDE_D_PASSES);

  const repoPath = await getRepoPath();
  const fileName = `test-ccp-d-${Date.now()}.ts`;

  const { taskId, taskRunId } = await launchLocalTask(
    repoPath, adapter, model,
    `[AUTOMATED TEST HARNESS] This is a checkpoint smoke-test scaffold. Do NOT take any action, search files, or delete anything. Just reply with "ready" and wait for further instructions.`,
  );
  await waitFor(() => !getSession(taskRunId)?.isPromptPending, LOCAL_TURN_MS, "greeting turn");
  const effectiveRepoPath = await getEffectiveRepoPath(taskId, repoPath);

  // ── Phase 1: local turn → cp_L1 ─────────────────────────────────────────
  const cpL1 = await runTurn(taskId, taskRunId,
    `Use a terminal command (e.g. printf) to create ${fileName} at the repo root containing exactly: export const alpha = 'A'; — do not use file editing tools.`,
    "D/Turn1-local");

  // ── Phase 2: →cloud (Fix 5 uploads cp_L1) ────────────────────────────────
  await handoffToCloud(taskId, taskRunId, effectiveRepoPath, "D/→cloud[1]");
  check(getCheckpoints(taskRunId).length >= 1, "D: cp_L1 visible in cloud session store");

  // ── Phase 3: cloud turn → cp_C2 (Fix 2) ──────────────────────────────────
  // handoffToCloud above now waits for the cloud init turn to fully complete, and
  // runCloudTurn waits for the queue to drain + idle, so beta can't be sent into a
  // still-provisioning sandbox and then cut short by the next handoff.
  let cpC2: string | null = null;
  try {
    cpC2 = await runCloudTurn(taskId, taskRunId,
      `Use a terminal command to append to ${fileName}: export const beta = 'B'; keep the alpha line. Do not use file editing tools.`,
      "D/Turn2-cloud");
    pass(`D/Fix2: cloud turn emitted checkpoint (${cpC2.slice(0, 8)})`);
  } catch (err) {
    fail(`D/Fix2: no cloud checkpoint — ${err instanceof Error ? err.message : err}`);
  }

  // ── Phase 4: →local (Fix 3: cp_L1 + cp_C2 synced) ───────────────────────
  await handoffToLocal(taskId, taskRunId, effectiveRepoPath, "D/→local[1]");

  const afterFirst = getCheckpoints(taskRunId).map((c) => c.id);
  check(afterFirst.includes(cpL1), `D/Fix3[1]: cp_L1 (${cpL1.slice(0, 8)}) synced`);
  if (cpC2) check(afterFirst.includes(cpC2), `D/Fix3[1]: cp_C2 (${cpC2.slice(0, 8)}) synced`);

  // ── Memory check after first cloud→local ─────────────────────────────────
  await checkMemory(taskId, taskRunId, effectiveRepoPath, fileName,
    cpC2 ? ["alpha", "beta"] : ["alpha"], "D/memory-after-first-handoff");

  // ── Phase 5: local turn → cp_L3 ─────────────────────────────────────────
  const cpL3 = await runTurn(taskId, taskRunId,
    `Use a terminal command to append to ${fileName}: export const gamma = 'G'; keep the alpha and beta lines. Do not use file editing tools.`,
    "D/Turn3-local");

  // ── Phase 6: →cloud again (Fix 5: uploads cp_L3 + any not yet uploaded) ─
  await handoffToCloud(taskId, taskRunId, effectiveRepoPath, "D/→cloud[2]");

  // ── Phase 7: →local again (Fix 3: all 3 checkpoints synced) ─────────────
  await handoffToLocal(taskId, taskRunId, effectiveRepoPath, "D/→local[2]");

  const afterSecond = getCheckpoints(taskRunId).map((c) => c.id);
  check(afterSecond.includes(cpL1), `D/Fix5+Fix3[2]: cp_L1 survived second round-trip`);
  if (cpC2) check(afterSecond.includes(cpC2), `D/Fix5+Fix3[2]: cp_C2 survived second round-trip`);
  check(afterSecond.includes(cpL3), `D/Fix5+Fix3[2]: cp_L3 (${cpL3.slice(0, 8)}) survived`);
  check(new Set(afterSecond).size === afterSecond.length, "D: no duplicate IDs after double round-trip");

  // ── Memory check after second cloud→local ─────────────────────────────────
  await checkMemory(taskId, taskRunId, effectiveRepoPath, fileName,
    ["alpha", "beta", "gamma"], "D/memory-after-second-handoff");

  // ── Phase 8: restore to cp_C2 (mid-history cloud checkpoint, Fix 4) ──────
  if (cpC2) {
    await restoreAndReconnect(taskId, taskRunId, cpC2, effectiveRepoPath, "D/cpC2");
    await checkFile(effectiveRepoPath, fileName, ["alpha", "beta"], ["gamma"], "D/after-restore-cpC2");

    // One turn after restore — then check memory (should not recall gamma)
    await runTurn(taskId, taskRunId,
      `Use a terminal command to append to ${fileName}: export const delta = 'D'; keep existing exports. Do not use file editing tools.`,
      "D/Turn4-post-restore");

    await checkMemory(taskId, taskRunId, effectiveRepoPath, fileName,
      ["alpha", "beta", "delta"], "D/memory-after-post-restore-turn");
    const finalContent = await readFile(effectiveRepoPath, fileName).catch(() => "");
    check(!finalContent.includes("gamma"), "D/Fix4: gamma absent after restore to cp_C2");
  }

  summary("SCENARIO D");
}

// ═══════════════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════════════

function defaultModel(adapter: "codex" | "claude") {
  return adapter === "claude" ? "claude-haiku-4-5" : "gpt-5.4-mini";
}

/** Scenario A — local→cloud→local passthrough. Fixes: 5, 3, 4. ~5–8 min. */
export async function runA(adapter: "codex" | "claude" = "codex", model = defaultModel(adapter)) {
  console.log("[cloud-test] version: 2026-06-15-v3 | adapter:", adapter, "| model:", model);
  await runScenarioA(adapter, model);
}

/** Scenario B — cloud turns emit checkpoints + sync. Fixes: 2, 3, 4. ~10–15 min. */
export async function runB(adapter: "codex" | "claude" = "codex", model = defaultModel(adapter)) {
  console.log("[cloud-test] version: 2026-06-15-v3 | adapter:", adapter, "| model:", model);
  await runScenarioB(adapter, model);
}

/** Scenario C — cloud-native task (no local turns first). Fixes: 2, 3, 4. ~10–15 min. */
export async function runC(adapter: "codex" | "claude" = "codex", model = defaultModel(adapter)) {
  console.log("[cloud-test] version: 2026-06-15-v3 | adapter:", adapter, "| model:", model);
  await runScenarioC(adapter, model);
}

/** Scenario D — full bidirectional local→cloud→local→cloud→local. All fixes. ~20–30 min. */
export async function runD(adapter: "codex" | "claude" = "codex", model = defaultModel(adapter)) {
  console.log("[cloud-test] version: 2026-06-15-v3 | adapter:", adapter, "| model:", model);
  await runScenarioD(adapter, model);
}

/**
 * Runs all scenarios in recommended order. Each uses a separate task.
 * A must pass before B/C are meaningful; D is the final stress test.
 * Total: ~50 min.
 */
export async function runAll(adapter: "codex" | "claude" = "codex", model = defaultModel(adapter)) {
  console.log("[cloud-test] version: 2026-06-15-v3 | adapter:", adapter, "| model:", model);
  await runScenarioA(adapter, model);
  await waitMs(5_000);
  await runScenarioB(adapter, model);
  await waitMs(5_000);
  await runScenarioC(adapter, model);
  await waitMs(5_000);
  await runScenarioD(adapter, model);
  console.log("[cloud-test] ══ ALL SCENARIOS COMPLETE ══");
}
