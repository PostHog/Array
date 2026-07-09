import { POSTHOG_NOTIFICATIONS } from "@posthog/agent";
import { getSessionJsonlPath } from "@posthog/agent/adapters/claude/session/jsonl-hydration";
import { PostHogAPIClient } from "@posthog/agent/posthog-api";
import type { StoredEntry } from "@posthog/agent/types";
import { createGitClient } from "@posthog/git/client";
import { isLocked, waitForUnlock } from "@posthog/git/lock-detector";
import {
  deleteCheckpoint,
  RevertCheckpointSaga,
} from "@posthog/git/sagas/checkpoint";
import { inject, injectable } from "inversify";
import type { AgentService } from "../agent/agent";
import type { AgentAuthAdapter } from "../agent/auth-adapter";
import { AGENT_AUTH_ADAPTER, AGENT_SERVICE } from "../agent/identifiers";
import { LOGS_SERVICE } from "../local-logs/identifiers";

export interface CheckpointRestoreInput {
  checkpointId: string;
  repoPath: string;
  taskRunId?: string;
}

export interface CheckpointRestoreResult {
  restoredSessionId?: string;
  truncationFailed: boolean;
  adapter?: "claude" | "codex";
}

/** Minimal slice of the local-logs gateway the restore re-seed needs. */
interface CheckpointLocalLogs {
  writeLocalLogs(taskRunId: string, content: string): Promise<void>;
}

/** Serialize stored log entries back to newline-delimited JSON. */
function entriesToNdjson(entries: StoredEntry[]): string {
  if (entries.length === 0) return "";
  return `${entries.map((e) => JSON.stringify(e)).join("\n")}\n`;
}

/**
 * Trim a re-seeded logs.ndjson cache to the restore target's turn, keyed off the
 * checkpoint marker's TIMESTAMP rather than its line position or promptId.
 *
 * Why timestamp: after a local→cloud→local round-trip the pre-handoff checkpoint
 * markers are re-appended to the END of the run log (handoff `uploadPriorLocal-
 * Checkpoints`), so a pre-handoff checkpoint's marker is no longer in chronological
 * line order — the backend's checkpoint-id truncation and a line-position trim both
 * no-op (observed: 119→119 lines). promptId is also unusable: it collides across
 * the two session numbering spaces (observed: two distinct checkpoints both pid=2).
 * The marker keeps its ORIGINAL timestamp through the re-append, and every log entry
 * carries an ISO-8601 `…Z` timestamp (lexicographically == chronologically sortable),
 * so the marker's timestamp is a stable, handoff-safe boundary.
 *
 * Keeps entries with `timestamp <= boundary` plus the target marker itself (its
 * re-appended copy may carry a fresh restore-time timestamp). Returns null when the
 * target marker can't be located (caller leaves the cache as-is).
 */
export function trimReseededCacheToCheckpoint(
  logText: string,
  checkpointId: string,
): string | null {
  const lines = logText.split("\n").filter((l) => l.trim());
  const isTargetMarker = (parsed: {
    notification?: { method?: string; params?: { checkpointId?: string } };
  }): boolean =>
    parsed.notification?.method === POSTHOG_NOTIFICATIONS.GIT_CHECKPOINT &&
    parsed.notification.params?.checkpointId === checkpointId;

  // Boundary = the target checkpoint's TURN-completion time. Prefer the
  // `turnCompletedAt` carried in the marker's params: it's the true turn boundary
  // and is stable across the S3 round-trip and the restore-time re-append. Only
  // when no target marker carries it (pre-fix or cloud-registered checkpoints) do
  // we fall back to the earliest marker ENTRY timestamp — which is
  // capture-completion time and therefore keeps later turns when the snapshot
  // outlives the next prompt, but preserves prior behavior for older logs.
  let turnBoundaryTs: string | null = null;
  let markerTs: string | null = null;
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as {
        timestamp?: string;
        notification?: {
          method?: string;
          params?: { checkpointId?: string; turnCompletedAt?: string };
        };
      };
      if (!isTargetMarker(parsed)) continue;
      const tca = parsed.notification?.params?.turnCompletedAt;
      if (tca && (turnBoundaryTs === null || tca < turnBoundaryTs)) {
        turnBoundaryTs = tca;
      }
      // EARLIEST marker occurrence (the original, not a restore-time re-append
      // which sorts later).
      if (
        parsed.timestamp &&
        (markerTs === null || parsed.timestamp < markerTs)
      ) {
        markerTs = parsed.timestamp;
      }
    } catch {
      // skip unparseable lines
    }
  }
  const boundaryTs = turnBoundaryTs ?? markerTs;
  if (boundaryTs === null) return null;

  const kept: string[] = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as {
        timestamp?: string;
        notification?: {
          method?: string;
          params?: { checkpointId?: string; turnCompletedAt?: string };
        };
      };
      // For a GIT_CHECKPOINT marker, compare by its TURN boundary
      // (params.turnCompletedAt), not its entry timestamp: captures are async and
      // land late, so an EARLIER surviving turn's marker can have an entry
      // timestamp past the boundary even though its turn completed before it.
      // Comparing by the entry timestamp would drop that survivor's marker,
      // leaving the (kept) turn with a "no checkpoint captured" icon. Non-marker
      // entries compare by their own timestamp as before.
      const isMarker =
        parsed.notification?.method === POSTHOG_NOTIFICATIONS.GIT_CHECKPOINT;
      const effectiveTs = isMarker
        ? (parsed.notification?.params?.turnCompletedAt ?? parsed.timestamp)
        : parsed.timestamp;
      // Keep everything up to and including the boundary, plus the target marker
      // itself regardless of its (possibly re-appended) timestamp.
      if (
        isTargetMarker(parsed) ||
        (effectiveTs != null && effectiveTs <= boundaryTs)
      ) {
        kept.push(line);
      }
    } catch {
      // Preserve unparseable lines conservatively (rare).
      kept.push(line);
    }
  }
  return `${kept.join("\n")}\n`;
}

/**
 * Restores a session to a git checkpoint: reverts working-tree files, truncates
 * the S3 log + local cache + agent memory to the checkpoint boundary, cleans up
 * orphaned checkpoint refs, and restarts the agent so it reconnects with memory
 * bounded to the restored turn.
 *
 * Runs in the host (main) process: it drives git/fs directly and reaches the
 * agent runtime + local-log cache through the injected AgentService and
 * local-logs gateway. Exposed to the renderer via the host-router checkpoint
 * router (this.d.trpc.checkpoint on the session service).
 */
/**
 * How long the restore waits for a busy `.git/index.lock` to clear before giving
 * up. A normal reset/read-tree releases the lock in well under a second, and a
 * turn's checkpoint capture works off a temp index (so it never holds this lock),
 * so a lock present here is almost always a brief external touch (editor, hook).
 * 15s comfortably covers those without hanging the UI if something is truly stuck.
 */
const RESTORE_INDEX_LOCK_WAIT_MS = 15_000;

/**
 * How many times to retry the revert when it fails specifically because an
 * external holder grabbed `.git/index.lock` mid-operation. A pre-flight wait
 * can't cover this (a holder can appear after the check but before the reset —
 * check-then-act), so we retry the operation itself, waiting for the lock to
 * clear between attempts. Bounded so a genuinely stuck lock still surfaces a
 * clear, retryable error instead of hanging.
 */
const RESTORE_INDEX_LOCK_MAX_RETRIES = 3;

/**
 * True when a git error is the transient `.git/index.lock` contention failure
 * (another process held the index lock when reset/read-tree tried to acquire it).
 * Git fails at lock-acquisition, before mutating anything, so the revert is safe
 * to retry once the lock clears.
 */
function isIndexLockError(message: string | undefined): boolean {
  if (!message) return false;
  return /index\.lock|Unable to create .*\.lock|File exists/i.test(message);
}

@injectable()
export class CheckpointService {
  // Guards against concurrent restores for the same session. Two restores racing
  // would truncate logs.ndjson + the rollout at different offsets and corrupt
  // both. Keyed by taskRunId (falling back to repoPath when there is no run).
  private readonly restoreInFlight = new Set<string>();

  constructor(
    @inject(AGENT_SERVICE)
    private readonly agentService: AgentService,
    @inject(AGENT_AUTH_ADAPTER)
    private readonly authAdapter: AgentAuthAdapter,
    @inject(LOGS_SERVICE)
    private readonly logs: CheckpointLocalLogs,
  ) {}

  /**
   * Re-emit stored checkpoint notifications for a session through the existing
   * SessionEvent channel so the renderer receives them after a reconnect.
   */
  replayCheckpoints(taskRunId: string): { count: number } {
    return { count: this.agentService.replayCheckpoints(taskRunId) };
  }

  async restore(
    input: CheckpointRestoreInput,
  ): Promise<CheckpointRestoreResult> {
    const lockKey = input.taskRunId ?? input.repoPath;
    if (this.restoreInFlight.has(lockKey)) {
      throw new Error(
        "A checkpoint restore is already in progress for this session. Please wait for it to finish.",
      );
    }
    this.restoreInFlight.add(lockKey);
    try {
      return await this.runRestore(input);
    } finally {
      this.restoreInFlight.delete(lockKey);
    }
  }

  private apiClientFor(info: {
    apiHost: string;
    projectId: number;
  }): PostHogAPIClient {
    return new PostHogAPIClient(
      this.authAdapter.createPosthogConfig({
        apiHost: info.apiHost,
        projectId: info.projectId,
      }),
    );
  }

  /**
   * Performs the actual checkpoint restore. Returns `truncationFailed: true` when
   * any log/rollout truncation step errored. The git revert still succeeded in
   * that case, but the agent may keep memory past the checkpoint, so the renderer
   * surfaces a warning to the user.
   */
  private async runRestore(
    input: CheckpointRestoreInput,
  ): Promise<CheckpointRestoreResult> {
    // 1. Revert git files to checkpoint state, retrying on `.git/index.lock`
    // contention. RevertCheckpointSaga's reset/read-tree acquire `.git/index.lock`,
    // and git fails hard ("Unable to create '.git/index.lock': File exists") if
    // anything else holds it at that instant — a git hook, the user's own editor/
    // terminal touching the same working tree, or a just-finishing operation.
    // That failure is transient (the lock clears in seconds) and happens at lock-
    // acquisition BEFORE git mutates anything, so the revert is safe to retry.
    // A pre-flight wait alone can't cover it: a holder can appear after the check
    // but before the reset (check-then-act race), which is why an earlier
    // pre-check-only guard still hit the error. So we wait for the lock to clear,
    // attempt the revert, and on a lock-specific failure wait + retry, bounded.
    // (Deliberately NOT auto-removing the lock: a live git process may hold it,
    // and force-deleting a live lock risks index corruption.)
    const saga = new RevertCheckpointSaga();
    let result: Awaited<ReturnType<typeof saga.run>> | undefined;
    for (let attempt = 0; ; attempt++) {
      // Give any current holder a chance to release before attempting.
      if (await isLocked(input.repoPath)) {
        await waitForUnlock(input.repoPath, RESTORE_INDEX_LOCK_WAIT_MS);
      }
      result = await saga.run({
        baseDir: input.repoPath,
        checkpointId: input.checkpointId,
      });
      if (result.success) break;

      const lockBusy = isIndexLockError(result.error);
      if (lockBusy && attempt < RESTORE_INDEX_LOCK_MAX_RETRIES) {
        // A holder raced us mid-operation; wait for it to clear, then retry.
        await waitForUnlock(input.repoPath, RESTORE_INDEX_LOCK_WAIT_MS);
        continue;
      }
      if (lockBusy) {
        throw new Error(
          "The repository's git index is busy — another git operation is still in progress. Wait a moment and try the restore again.",
        );
      }
      throw new Error(result.error ?? "Failed to revert checkpoint");
    }

    // 2. Truncate logs, clean up orphaned refs, and restart the agent.
    // Everything here is non-fatal: git files were already reverted.
    let restoredSessionId: string | undefined;
    // The live session's adapter (codex/claude), read before cancelSession kills it.
    // Returned so the renderer reconnects on the SAME runtime instead of trusting its
    // own stale session.adapter (which can default to "claude" for handed-off tasks).
    let restoredAdapter: "claude" | "codex" | undefined;
    // Tracks whether any truncation step failed, so the renderer can warn that
    // the restore was partial (agent memory may extend past the checkpoint).
    let truncationFailed = false;
    if (input.taskRunId) {
      try {
        const info = this.agentService.getSessionInfo(input.taskRunId);
        if (info) {
          restoredSessionId = info.sessionId;
          restoredAdapter = info.adapter;
          const apiClient = this.apiClientFor(info);
          let orphanedCheckpointIds: string[] = [];
          // Checkpoints that must NOT have their git refs deleted: the restore
          // target is always a survivor; the rest are filled from the in-memory
          // map and the truncated log below. The backend's orphan list can wrongly
          // include survivors after a handoff (scrambled S3 log), and deleting a
          // survivor's ref makes that turn un-restorable ("Checkpoint not found").
          const survivorCheckpointIds = new Set<string>([input.checkpointId]);
          for (const id of this.agentService.getSurvivingCheckpointIds(
            input.taskRunId,
            input.checkpointId,
          )) {
            survivorCheckpointIds.add(id);
          }

          // Truncate S3 + local cache BEFORE cancelling the session.
          // cancelSession triggers reconnect; if reconnect reads local cache
          // before truncation, the stale full history would be loaded.
          try {
            // Truncate by checkpoint_id only — do NOT send prompt_id. After a handoff
            // the per-taskRun checkpoint map mixes promptIds from two session numbering
            // spaces, so a checkpoint's stored promptId can point at the wrong entry and
            // keep restore-truncated turns. The backend locates the boundary by
            // checkpoint_id position — the same handoff-safe boundary the renderer's
            // truncateEventsToCheckpoint and the local-cache trim below use.
            const s3Result = await apiClient.truncateTaskRunLog(
              info.taskId,
              input.taskRunId,
              input.checkpointId,
            );
            if (s3Result.truncated) {
              orphanedCheckpointIds = s3Result.orphaned_checkpoint_ids ?? [];
            }

            // Re-append surviving checkpoint markers that the truncate dropped.
            // The restored turn's own marker always sits after its prompt response,
            // so the position-based S3 truncate removes it. Worse: captures are async
            // and can finish SEVERAL turns late (minutes on a large repo), so an
            // EARLIER surviving turn's marker can physically land in the log AFTER the
            // target's marker — and the position truncate then cuts that survivor too,
            // leaving it with a disabled "no checkpoint captured" icon even though it
            // survives the restore (and it stays broken across reload, since S3 + the
            // cache no longer carry it). The in-memory map still has every survivor
            // with its authoritative promptId + true turnCompletedAt, so reconstruct
            // each survivor's marker and re-append the ones the truncate removed —
            // keeping ALL surviving turns restorable in the live view and on reload.
            const survivingEntries =
              this.agentService.getSurvivingCheckpointEntries(
                input.taskRunId,
                input.checkpointId,
              );
            const buildMarkerEntry = (e: {
              checkpointId: string;
              promptId: number | undefined;
              turnCompletedAt?: string;
            }): StoredEntry => ({
              type: "notification",
              // Prefer the true turn-completion time so the marker sits on the
              // correct boundary; only fall back to "now" (restore time) when the
              // turn timestamp is unknown (pre-fix/cloud-registered checkpoints).
              timestamp: e.turnCompletedAt ?? new Date().toISOString(),
              notification: {
                jsonrpc: "2.0",
                method: POSTHOG_NOTIFICATIONS.GIT_CHECKPOINT,
                params: {
                  checkpointId: e.checkpointId,
                  promptId: e.promptId,
                  turnCompletedAt: e.turnCompletedAt,
                },
              },
            });

            // Re-seed the local logs.ndjson cache from the (now truncated, with any
            // dropped survivor markers re-appended) S3 run log. The cache is a live
            // append-mirror that, after a cloud→local handoff, was overwritten
            // wholesale with the cloud log (handoff seedLocalLogs) and so lacks the
            // pre-handoff checkpoint marker — a marker-based local trim can't cut at
            // the restore point. Reload reads this cache first, so without re-seeding
            // it the restore-truncated turns reappear on reload. We fetch the run log
            // authoritatively (the renderer's session.logUrl is unreliable for
            // handed-off tasks) and overwrite the cache before cancelSession triggers
            // the reconnect. Non-fatal: git files are already reverted; a failure only
            // means reload may show stale turns or a disabled survivor icon.
            if (s3Result.truncated) {
              try {
                const taskRun = await apiClient.getTaskRun(
                  info.taskId,
                  input.taskRunId,
                );
                let truncatedEntries =
                  await apiClient.fetchTaskRunLogs(taskRun);

                // Which surviving markers did the position-based truncate drop?
                // Re-append those (target included — it's always dropped) so every
                // survivor's marker is durable in S3 and present in the cache below.
                const presentCheckpointIds = new Set<string>();
                for (const entry of truncatedEntries) {
                  const notif = (
                    entry as {
                      notification?: {
                        method?: string;
                        params?: { checkpointId?: string };
                      };
                    }
                  ).notification;
                  if (
                    notif?.method === POSTHOG_NOTIFICATIONS.GIT_CHECKPOINT &&
                    notif.params?.checkpointId
                  ) {
                    presentCheckpointIds.add(notif.params.checkpointId);
                  }
                }
                const missingMarkers = survivingEntries
                  .filter(
                    (e) =>
                      e.promptId != null &&
                      !presentCheckpointIds.has(e.checkpointId),
                  )
                  .map(buildMarkerEntry);
                if (missingMarkers.length > 0) {
                  await apiClient
                    .appendTaskRunLog(
                      info.taskId,
                      input.taskRunId,
                      missingMarkers,
                    )
                    .catch(() => {
                      // Non-fatal: a survivor may show a disabled restore icon.
                    });
                  // Include locally without a second round-trip so the cache we
                  // write below carries them even if the S3 append lagged.
                  truncatedEntries = [...truncatedEntries, ...missingMarkers];
                }

                const truncatedLog = entriesToNdjson(truncatedEntries);
                if (truncatedLog.trim()) {
                  // The backend truncates by checkpoint-id position, which no-ops
                  // when the restore target is a pre-handoff checkpoint (its marker
                  // was re-appended to the log tail). Trim by the marker's timestamp
                  // so reload doesn't resurrect post-restore turns. Falls back to the
                  // backend log when the marker can't be located.
                  const trimmedLog =
                    trimReseededCacheToCheckpoint(
                      truncatedLog,
                      input.checkpointId,
                    ) ?? truncatedLog;
                  await this.logs.writeLocalLogs(input.taskRunId, trimmedLog);
                  // Every GIT_CHECKPOINT marker still present in the truncated
                  // log is a surviving checkpoint — protect its ref from the
                  // orphan-cleanup below. This source survives an app restart
                  // (unlike the in-memory map).
                  for (const entry of truncatedEntries) {
                    const notif = (
                      entry as {
                        notification?: {
                          method?: string;
                          params?: { checkpointId?: string };
                        };
                      }
                    ).notification;
                    if (
                      notif?.method === POSTHOG_NOTIFICATIONS.GIT_CHECKPOINT &&
                      notif.params?.checkpointId
                    ) {
                      survivorCheckpointIds.add(notif.params.checkpointId);
                    }
                  }
                }
              } catch {
                // Non-fatal: reload may show stale turns.
              }
            }
          } catch {
            truncationFailed = true;
          }

          // Clean up git refs for orphaned checkpoints — but NEVER delete a
          // surviving checkpoint or the restore target. The backend's orphan list
          // is computed from the S3 log, which after a handoff mixes pre/post-handoff
          // checkpoints and can over-include survivors (even the restore target).
          // Deleting a survivor's ref is what made earlier turns un-restorable
          // ("Checkpoint not found"). A leftover orphan ref is benign, so over-
          // deletion is the only harmful direction — when in doubt, keep.
          const idsToDelete = orphanedCheckpointIds.filter(
            (id) => !survivorCheckpointIds.has(id),
          );
          if (idsToDelete.length > 0) {
            const git = createGitClient(input.repoPath);
            await Promise.all(
              idsToDelete.map((id) =>
                deleteCheckpoint(git, id).catch(() => {}),
              ),
            );
          }

          // Trim in-memory checkpoints so replayCheckpoints only re-emits
          // survivors — must happen before cancelSession triggers reconnect.
          this.agentService.truncateCheckpoints(
            input.taskRunId,
            input.checkpointId,
          );

          // Mark this taskRunId so the reconnect rebuilds agent memory bounded to
          // the checkpoint: Claude force-refetches the truncated S3 into its JSONL;
          // Codex (no JSONL hydration) starts a FRESH session seeded with a context
          // summary of the truncated conversation. Must be set before cancelSession
          // triggers the reconnect.
          this.agentService.markCheckpointRestore(input.taskRunId);

          // Cancel the session — the renderer reconnects and rebuilds bounded memory.
          await this.agentService.cancelSession(input.taskRunId);

          // Codex needs no on-disk rollout truncation here: the reconnect abandons
          // the stale rollout (fresh session) and injects a bounded summary. A
          // turn-count truncation couldn't strip history embedded inside the handoff
          // summary turn anyway, so it's both unnecessary and insufficient.
          if (info.adapter === "claude") {
            // Delete the stale local Claude JSONL so the SDK doesn't read full
            // conversation history before hydrateSessionJsonl re-fetches the
            // truncated version from S3. This fixes a race where an immediate
            // page-reload after restore causes the agent to remember turns that
            // should have been forgotten. Non-fatal if the file is already gone.
            const jsonlPath = getSessionJsonlPath(
              info.sessionId,
              info.repoPath,
            );
            try {
              const { unlink } = await import("node:fs/promises");
              await unlink(jsonlPath);
            } catch (err: unknown) {
              // ENOENT is fine — file may already be absent
              const code = (err as NodeJS.ErrnoException).code;
              if (code !== "ENOENT") {
                // Non-fatal: hydrateSessionJsonl still re-fetches the truncated log.
              }
            }
          }
        }
      } catch {
        truncationFailed = true;
      }
    }

    return { restoredSessionId, truncationFailed, adapter: restoredAdapter };
  }
}
