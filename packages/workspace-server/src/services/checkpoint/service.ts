import { POSTHOG_NOTIFICATIONS } from "@posthog/agent";
import { getSessionJsonlPath } from "@posthog/agent/adapters/claude/session/jsonl-hydration";
import { PostHogAPIClient } from "@posthog/agent/posthog-api";
import type { StoredEntry } from "@posthog/agent/types";
import { createGitClient } from "@posthog/git/client";
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
function trimReseededCacheToCheckpoint(
  logText: string,
  checkpointId: string,
): string | null {
  const lines = logText.split("\n").filter((l) => l.trim());
  const isTargetMarker = (parsed: {
    notification?: { method?: string; params?: { checkpointId?: string } };
  }): boolean =>
    parsed.notification?.method === POSTHOG_NOTIFICATIONS.GIT_CHECKPOINT &&
    parsed.notification.params?.checkpointId === checkpointId;

  let boundaryTs: string | null = null;
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as {
        timestamp?: string;
        notification?: { method?: string; params?: { checkpointId?: string } };
      };
      if (isTargetMarker(parsed) && parsed.timestamp) {
        // Use the EARLIEST occurrence's timestamp as the boundary (the original
        // marker, not a restore-time re-append which sorts later).
        if (boundaryTs === null || parsed.timestamp < boundaryTs) {
          boundaryTs = parsed.timestamp;
        }
      }
    } catch {
      // skip unparseable lines
    }
  }
  if (boundaryTs === null) return null;

  const kept: string[] = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as {
        timestamp?: string;
        notification?: { method?: string; params?: { checkpointId?: string } };
      };
      // Keep everything up to and including the boundary timestamp, plus the
      // target marker itself regardless of its (possibly re-appended) timestamp.
      if (
        isTargetMarker(parsed) ||
        (parsed.timestamp != null && parsed.timestamp <= boundaryTs)
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
    // 1. Revert git files to checkpoint state
    const saga = new RevertCheckpointSaga();
    const result = await saga.run({
      baseDir: input.repoPath,
      checkpointId: input.checkpointId,
    });
    if (!result.success) {
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
            // promptId is metadata for the re-added restored-checkpoint marker only
            // (the renderer matches checkpoints by checkpointId). It is intentionally
            // NOT used as a truncation boundary anywhere — see notes below.
            const promptId = this.agentService.getCheckpointPromptId(
              input.taskRunId,
              input.checkpointId,
            );
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

            // The restored turn's own git_checkpoint notification sits after its
            // prompt response, so BOTH the S3 truncate and the local prompt-
            // boundary trim drop it — leaving the restored turn with a disabled
            // restore icon after a restart. Re-add it to both stores so the
            // restored turn stays restorable.
            const restoredCheckpointEntry: StoredEntry | undefined =
              promptId != null
                ? {
                    type: "notification",
                    timestamp: new Date().toISOString(),
                    notification: {
                      jsonrpc: "2.0",
                      method: POSTHOG_NOTIFICATIONS.GIT_CHECKPOINT,
                      params: {
                        checkpointId: input.checkpointId,
                        promptId,
                      },
                    },
                  }
                : undefined;

            // Re-append to S3 only when the truncate actually removed it (else
            // the checkpoint is still there and re-appending would duplicate).
            if (s3Result.truncated && restoredCheckpointEntry) {
              await apiClient
                .appendTaskRunLog(info.taskId, input.taskRunId, [
                  restoredCheckpointEntry,
                ])
                .catch(() => {
                  // Non-fatal: the restored turn simply may show a disabled
                  // restore icon after a restart.
                });
            }

            // Re-seed the local logs.ndjson cache from the (now truncated, with the
            // restored marker re-appended) S3 run log. The cache is a live append-
            // mirror that, after a cloud→local handoff, was overwritten wholesale with
            // the cloud log (handoff seedLocalLogs) and so lacks the pre-handoff
            // checkpoint marker — a marker-based local trim can't cut at the restore
            // point. Reload reads this cache first, so without re-seeding it the
            // restore-truncated turns reappear on reload. We fetch the run log
            // authoritatively (the renderer's session.logUrl is unreliable for
            // handed-off tasks) and overwrite the cache before cancelSession triggers
            // the reconnect. Non-fatal: git files are already reverted; a failure only
            // means reload may show stale turns.
            if (s3Result.truncated) {
              try {
                const taskRun = await apiClient.getTaskRun(
                  info.taskId,
                  input.taskRunId,
                );
                const truncatedEntries =
                  await apiClient.fetchTaskRunLogs(taskRun);
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
              idsToDelete.map((id) => deleteCheckpoint(git, id).catch(() => {})),
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
            const jsonlPath = getSessionJsonlPath(info.sessionId, info.repoPath);
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
