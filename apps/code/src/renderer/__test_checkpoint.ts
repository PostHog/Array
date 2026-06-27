/**
 * Checkpoint restore smoke test — creates its own task, runs 3 turns, restores to turn 1.
 *
 * Import in Electron devtools console:
 *   const m = await import('/src/renderer/__test_checkpoint.ts');
 *
 * Then call with desired adapter:
 *   m.run();                                      // codex (default)
 *   m.run("codex", "gpt-5.4-mini");               // codex explicit
 *   m.run("claude", "claude-haiku-4-5");           // claude / haiku
 */
import { get } from "@renderer/di/container";
import { RENDERER_TOKENS } from "@renderer/di/tokens";
import type { TaskService } from "@renderer/features/task-detail/service/service";
import { getSessionService } from "@renderer/features/sessions/service/service";
import { sessionStoreSetters, useSessionStore } from "@renderer/features/sessions/stores/sessionStore";
import { trpcClient } from "@renderer/trpc/client";
import { useNavigationStore } from "@renderer/stores/navigationStore";

const CONNECT_TIMEOUT_MS = 30_000;
const TURN_TIMEOUT_MS = 90_000;
const CP_TIMEOUT_MS = 45_000;

function waitMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function waitForCondition(check: () => boolean, timeoutMs: number, label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const id = setInterval(() => {
      if (check()) { clearInterval(id); resolve(); return; }
      if (Date.now() > deadline) { clearInterval(id); reject(new Error("Timeout: " + label)); }
    }, 400);
  });
}

function waitForCheckpoint(taskRunId: string, afterTs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + CP_TIMEOUT_MS;
    const id = setInterval(() => {
      const evts = useSessionStore.getState().sessions[taskRunId]?.events ?? [];
      for (const e of evts) {
        const msg = e.message as { method?: string; params?: { checkpointId?: string } };
        if (msg.method === "_posthog/git_checkpoint" && e.ts > afterTs && msg.params?.checkpointId) {
          clearInterval(id); resolve(msg.params.checkpointId); return;
        }
      }
      if (Date.now() > deadline) { clearInterval(id); reject(new Error("Timeout waiting for checkpoint")); }
    }, 800);
  });
}

async function launchTask(
  repoPath: string,
  adapter: "codex" | "claude",
  model: string,
): Promise<{ taskId: string; taskRunId: string }> {
  const taskSvc = get<TaskService>(RENDERER_TOKENS.TaskService);
  const result = await taskSvc.createTask({
    content: "[checkpoint-test] scratch task — safe to delete",
    repoPath,
    workspaceMode: "local",
    adapter,
    model,
    executionMode: "auto",
  });
  if (!result.success) throw new Error("createTask failed: " + result.error);

  const task = result.data.task;
  useNavigationStore.getState().navigateToTask(task);
  console.log("[test] Created task", task.id, "— navigated to it");

  await waitForCondition(
    () => {
      const s = Object.values(useSessionStore.getState().sessions).find(
        (s) => s.taskId === task.id && s.status === "connected",
      );
      return !!s;
    },
    CONNECT_TIMEOUT_MS,
    "session connected",
  );

  const s = Object.values(useSessionStore.getState().sessions).find(
    (s) => s.taskId === task.id && s.status === "connected",
  )!;
  console.log("[test] Session connected — taskRunId:", s.taskRunId);
  return { taskId: task.id, taskRunId: s.taskRunId };
}

async function runTest(
  adapter: "codex" | "claude" = "codex",
  model = adapter === "claude" ? "claude-haiku-4-5" : "gpt-5.4-mini",
): Promise<void> {
  console.log("[test] version: 2026-06-13-v1 | adapter:", adapter, "| model:", model);
  const folders = await trpcClient.folders.getFolders.query();
  const folder = folders.find((f) => f.exists !== false);
  if (!folder) throw new Error("No registered folders — add a folder in the sidebar first");
  const repoPath = folder.path;
  console.log("[test] Using folder:", repoPath);

  const { taskId, taskRunId } = await launchTask(repoPath, adapter, model);
  const svc = getSessionService();

  await waitForCondition(
    () => useSessionStore.getState().sessions[taskRunId]?.isPromptPending === false,
    TURN_TIMEOUT_MS,
    "initial agent turn",
  );

  const workspaces = await trpcClient.workspace.getAll.query();
  const ws = workspaces[taskId];
  const effectiveRepoPath = ws?.worktreePath ?? ws?.folderPath ?? repoPath;

  const fileName = `test-checkpoint-${Date.now()}.ts`;
  console.log("[test] Using file:", fileName);

  console.log("[test] === Turn 1: create file ===");
  const t1 = Date.now();
  await svc.sendPrompt(taskId, `Create a file called ${fileName} at the repo root with: export const alpha = 'A';`);
  await waitForCondition(() => !useSessionStore.getState().sessions[taskRunId]?.isPromptPending, TURN_TIMEOUT_MS, "turn 1");
  const cp1 = await waitForCheckpoint(taskRunId, t1);
  console.log("[test] cp1:", cp1);

  console.log("[test] === Turn 2: add beta ===");
  const t2 = Date.now();
  await svc.sendPrompt(taskId, `Add to ${fileName}: export const beta = 'B'; keep alpha.`);
  await waitForCondition(() => !useSessionStore.getState().sessions[taskRunId]?.isPromptPending, TURN_TIMEOUT_MS, "turn 2");
  const cp2 = await waitForCheckpoint(taskRunId, t2);
  console.log("[test] cp2:", cp2);

  console.log("[test] === Turn 3: add gamma ===");
  const t3 = Date.now();
  await svc.sendPrompt(taskId, `Add to ${fileName}: export const gamma = 'G'; keep alpha and beta.`);
  await waitForCondition(() => !useSessionStore.getState().sessions[taskRunId]?.isPromptPending, TURN_TIMEOUT_MS, "turn 3");
  const cp3 = await waitForCheckpoint(taskRunId, t3);
  console.log("[test] cp3:", cp3);

  console.log("[test] 3 turns done — UI should show Restore on each.", { cp1, cp2, cp3 });

  console.log("[test] === Restoring to Turn 1 (cp1) ===");
  const restoreResult = await trpcClient.checkpoint.restore.mutate({ checkpointId: cp1, repoPath: effectiveRepoPath, taskRunId });
  console.log("[test] Restore returned.", { restoredSessionId: restoreResult?.restoredSessionId });

  sessionStoreSetters.truncateEventsToCheckpoint(taskId, cp1);
  await svc.restoreCheckpointReconnect(taskId, effectiveRepoPath, restoreResult?.restoredSessionId, restoreResult?.adapter);
  console.log("[test] Reconnect done.");

  await waitMs(3_000);

  const finalEvts = useSessionStore.getState().sessions[taskRunId]?.events ?? [];
  const cpEvts = finalEvts.filter((e) => (e.message as { method?: string }).method === "_posthog/git_checkpoint");
  const promptEvts = finalEvts.filter((e) => (e.message as { method?: string }).method === "session/prompt");

  console.log("[test] checkpoint events after restore:", cpEvts.length, "(expect 2: greeting + cp1)");
  console.log("[test] session/prompt events after restore:", promptEvts.length, "(expect 2: greeting + Turn 1)");
  cpEvts.forEach((e, i) => {
    const p = (e.message as { params?: { checkpointId?: string; promptId?: number } }).params;
    console.log(`[test]   cp[${i}] id=${p?.checkpointId} promptId=${p?.promptId}`);
  });

  const lastCpId = cpEvts.length > 0
    ? (cpEvts[cpEvts.length - 1].message as { params?: { checkpointId?: string } }).params?.checkpointId
    : undefined;
  const noDuplicates = new Set(cpEvts.map(e => (e.message as { params?: { checkpointId?: string } }).params?.checkpointId)).size === cpEvts.length;

  if (cpEvts.length === 2 && lastCpId === cp1 && noDuplicates) {
    console.log("[test] ✓ PASS: 2 unique checkpoints (greeting + cp1), last is cp1");
  } else {
    console.error("[test] ✗ FAIL: expected 2 unique checkpoints ending with cp1, got", cpEvts.length, "checkpoints, last:", lastCpId, "noDuplicates:", noDuplicates);
  }
}

/** Run the checkpoint smoke test.
 *  @param adapter  "codex" (default) or "claude"
 *  @param model    defaults to "gpt-5.4-mini" for codex, "claude-haiku-4-5" for claude
 */
export const run = runTest;
