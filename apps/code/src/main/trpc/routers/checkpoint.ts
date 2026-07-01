import { POSTHOG_NOTIFICATIONS } from "@posthog/agent";
import { getSessionJsonlPath } from "@posthog/agent/adapters/claude/session/jsonl-hydration";
import { createGitClient } from "@posthog/git/client";
import {
  deleteCheckpoint,
  RevertCheckpointSaga,
} from "@posthog/git/sagas/checkpoint";
import { z } from "zod";
import { container } from "../../di/container";
import { MAIN_TOKENS } from "../../di/tokens";
import type { AgentService } from "../../services/agent/service";
import type { AuthService } from "../../services/auth/service";
import type { LocalLogsService } from "../../services/local-logs/service";
import { logger } from "../../utils/logger";
import { publicProcedure, router } from "../trpc";

const log = logger.scope("checkpoint-router");

// Guards against concurrent restores for the same session. Two restores racing
// would truncate logs.ndjson + the rollout at different offsets and corrupt
// both. Keyed by taskRunId (falling back to repoPath when there is no run).
const restoreInFlight = new Set<string>();

const getAgentService = () =>
  container.get<AgentService>(MAIN_TOKENS.AgentService);

const getAuthService = () =>
  container.get<AuthService>(MAIN_TOKENS.AuthService);

const getLocalLogsService = () =>
  container.get<LocalLogsService>(MAIN_TOKENS.LocalLogsService);

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
const trimReseededCacheToCheckpoint = (
  logText: string,
  checkpointId: string,
): string | null => {
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
      if (
        isTargetMarker(parsed) &&
        typeof parsed.timestamp === "string" &&
        (boundaryTs === null || parsed.timestamp < boundaryTs)
      ) {
        boundaryTs = parsed.timestamp;
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
      const ts = typeof parsed.timestamp === "string" ? parsed.timestamp : null;
      // Keep purely by timestamp. The target marker's earliest copy has
      // ts === boundaryTs so it is always retained (the turn stays restorable),
      // while later re-appended duplicates of it (fresh restore-time timestamps,
      // one per repeat-restore) are dropped — otherwise they accumulate in the
      // cache on every restore to the same checkpoint.
      if (ts !== null && ts <= boundaryTs) {
        kept.push(line);
      }
    } catch {
      // drop unparseable lines — they have no orderable timestamp
    }
  }
  return `${kept.join("\n")}\n`;
};

const restoreInput = z.object({
  checkpointId: z.string(),
  repoPath: z.string(),
  taskRunId: z.string().optional(),
});

export const checkpointRouter = router({
  /**
   * Re-emit stored checkpoint notifications for a session through the existing
   * SessionEvent channel so the renderer receives them after a reconnect.
   * Called after subscribeToChannel so events are not lost.
   */
  replayCheckpoints: publicProcedure
    .input(z.object({ taskRunId: z.string() }))
    .mutation(({ input }) => {
      const agentService = getAgentService();
      const count = agentService.replayCheckpoints(input.taskRunId);
      log.info("replayCheckpoints mutation", {
        taskRunId: input.taskRunId,
        count,
      });
      return { count };
    }),

  restore: publicProcedure.input(restoreInput).mutation(async ({ input }) => {
    // Reject overlapping restores for the same session (see restoreInFlight).
    const lockKey = input.taskRunId ?? input.repoPath;
    if (restoreInFlight.has(lockKey)) {
      throw new Error(
        "A checkpoint restore is already in progress for this session. Please wait for it to finish.",
      );
    }
    restoreInFlight.add(lockKey);
    try {
      return await runRestore(input);
    } finally {
      restoreInFlight.delete(lockKey);
    }
  }),
});

/**
 * Performs the actual checkpoint restore. Extracted so the mutation can wrap it
 * in the restoreInFlight lock with a try/finally.
 *
 * Returns `truncationFailed: true` when any log/rollout truncation step errored.
 * The git revert still succeeded in that case, but the agent may keep memory
 * past the checkpoint, so the renderer surfaces a warning to the user.
 */
async function runRestore(input: {
  checkpointId: string;
  repoPath: string;
  taskRunId?: string;
}): Promise<{
  restoredSessionId?: string;
  truncationFailed: boolean;
  adapter?: "claude" | "codex";
}> {
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
      const agentService = getAgentService();
      const info = agentService.getSessionInfo(input.taskRunId);
      if (info) {
        restoredSessionId = info.sessionId;
        restoredAdapter = info.adapter;
        let orphanedCheckpointIds: string[] = [];
        // Checkpoints that must NOT have their git refs deleted: the restore
        // target is always a survivor; the rest are filled from the in-memory
        // map and the truncated log below. The backend's orphan list can wrongly
        // include survivors after a handoff (scrambled S3 log), and deleting a
        // survivor's ref makes that turn un-restorable ("Checkpoint not found").
        const survivorCheckpointIds = new Set<string>([input.checkpointId]);
        for (const id of agentService.getSurvivingCheckpointIds(
          input.taskRunId,
          input.checkpointId,
        )) {
          survivorCheckpointIds.add(id);
        }

        // Truncate S3 + local cache BEFORE cancelling the session.
        // cancelSession triggers reconnect; if reconnect reads local cache
        // before truncation, the stale full history would be loaded.
        try {
          const authService = getAuthService();
          const url = `${info.apiHost}/api/projects/${info.projectId}/tasks/${info.taskId}/runs/${input.taskRunId}/truncate_log/`;
          // promptId is metadata for the re-added restored-checkpoint marker only
          // (the renderer matches checkpoints by checkpointId). It is intentionally
          // NOT used as a truncation boundary anywhere — see notes below.
          const promptId = agentService.getCheckpointPromptId(
            input.taskRunId,
            input.checkpointId,
          );
          // Truncate by checkpoint_id only — do NOT send prompt_id. After a handoff
          // the per-taskRun checkpoint map mixes promptIds from two session numbering
          // spaces, so a checkpoint's stored promptId can point at the wrong entry and
          // keep restore-truncated turns. The backend locates the boundary by
          // checkpoint_id position — the same handoff-safe boundary the renderer's
          // truncateEventsToCheckpoint and the local-cache trim below use.
          const response = await authService.authenticatedFetch(fetch, url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              checkpoint_id: input.checkpointId,
            }),
          });
          if (response.ok) {
            const s3Result = (await response.json()) as {
              truncated: boolean;
              original_line_count: number;
              truncated_line_count: number;
              orphaned_checkpoint_ids: string[];
            };
            log.info("S3 log truncated after checkpoint restore", {
              taskRunId: input.taskRunId,
              checkpointId: input.checkpointId,
              truncated: s3Result.truncated,
              originalLines: s3Result.original_line_count,
              truncatedLines: s3Result.truncated_line_count,
              orphanedCheckpoints: s3Result.orphaned_checkpoint_ids,
            });
            if (s3Result.truncated) {
              orphanedCheckpointIds = s3Result.orphaned_checkpoint_ids ?? [];
            } else {
              log.warn(
                "S3 log was not truncated — relying on client-side checkpoint-boundary trim",
                {
                  taskRunId: input.taskRunId,
                  checkpointId: input.checkpointId,
                },
              );
            }
            // The restored turn's own git_checkpoint notification sits after its
            // prompt response, so BOTH the S3 truncate and the local prompt-
            // boundary trim drop it — leaving the restored turn with a disabled
            // restore icon after a restart. Re-add it to both stores so the
            // restored turn stays restorable.
            const restoredCheckpointEntry =
              promptId != null
                ? {
                    type: "notification" as const,
                    timestamp: new Date().toISOString(),
                    notification: {
                      jsonrpc: "2.0" as const,
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
              const appendUrl = `${info.apiHost}/api/projects/${info.projectId}/tasks/${info.taskId}/runs/${input.taskRunId}/append_log/`;
              await authService
                .authenticatedFetch(fetch, appendUrl, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ entries: [restoredCheckpointEntry] }),
                })
                .then((res) => {
                  if (!res.ok) {
                    log.warn("Failed to re-append restored checkpoint to S3", {
                      taskRunId: input.taskRunId,
                      status: res.status,
                    });
                  }
                })
                .catch((err: unknown) => {
                  log.warn("Failed to re-append restored checkpoint to S3", {
                    taskRunId: input.taskRunId,
                    error: err instanceof Error ? err.message : String(err),
                  });
                });
            }

            // Re-seed the local logs.ndjson cache from the (now truncated, with the
            // restored marker re-appended) S3 run log. The cache is a live append-
            // mirror that, after a cloud→local handoff, was overwritten wholesale with
            // the cloud log (handoff seedLocalLogs) and so lacks the pre-handoff
            // checkpoint marker — a marker-based local trim can't cut at the restore
            // point. Reload reads this cache first (fetchSessionLogs), so without
            // re-seeding it the restore-truncated turns reappear on reload. We fetch
            // the run log authoritatively from main (the renderer's session.logUrl is
            // unreliable for handed-off tasks) and overwrite the cache before
            // cancelSession triggers the reconnect. Non-fatal: git files are already
            // reverted; a failure only means reload may show stale turns.
            if (s3Result.truncated) {
              try {
                const logsUrl = `${info.apiHost}/api/projects/${info.projectId}/tasks/${info.taskId}/runs/${input.taskRunId}/logs`;
                const logsResponse = await authService.authenticatedFetch(
                  fetch,
                  logsUrl,
                  { method: "GET" },
                );
                if (logsResponse.ok) {
                  const truncatedLog = await logsResponse.text();
                  if (truncatedLog.trim()) {
                    const localLogsSvc = getLocalLogsService();
                    localLogsSvc.cancelPendingWrite(input.taskRunId);
                    // The backend truncates by checkpoint-id position, which no-ops
                    // when the restore target is a pre-handoff checkpoint (its marker
                    // was re-appended to the log tail). Trim by the marker's timestamp
                    // so reload doesn't resurrect post-restore turns. Falls back to the
                    // backend log when the marker can't be located.
                    const trimmedLog =
                      trimReseededCacheToCheckpoint(
                        truncatedLog,
                        input.checkpointId,
                      ) ??
                      (truncatedLog.endsWith("\n")
                        ? truncatedLog
                        : `${truncatedLog}\n`);
                    await localLogsSvc.writeLocalLogs(
                      input.taskRunId,
                      trimmedLog,
                    );
                    log.info(
                      "Re-seeded local cache from truncated S3 after restore",
                      {
                        taskRunId: input.taskRunId,
                        checkpointId: input.checkpointId,
                        bytes: trimmedLog.length,
                        s3Bytes: truncatedLog.length,
                        timestampTrimmed:
                          trimmedLog.length < truncatedLog.length,
                      },
                    );
                    // Every GIT_CHECKPOINT marker still present in the truncated
                    // log is a surviving checkpoint — protect its ref from the
                    // orphan-cleanup below. This source survives an app restart
                    // (unlike the in-memory map).
                    for (const line of truncatedLog.split("\n")) {
                      if (!line.trim()) continue;
                      try {
                        const parsed = JSON.parse(line) as {
                          notification?: {
                            method?: string;
                            params?: { checkpointId?: string };
                          };
                        };
                        const notif = parsed.notification;
                        if (
                          notif?.method ===
                            POSTHOG_NOTIFICATIONS.GIT_CHECKPOINT &&
                          notif.params?.checkpointId
                        ) {
                          survivorCheckpointIds.add(notif.params.checkpointId);
                        }
                      } catch {
                        // skip unparseable lines
                      }
                    }
                  }
                } else {
                  log.warn(
                    "Failed to fetch truncated run log for local re-seed",
                    {
                      taskRunId: input.taskRunId,
                      status: logsResponse.status,
                    },
                  );
                }
              } catch (err) {
                log.warn(
                  "Failed to re-seed local cache from truncated S3 (non-fatal)",
                  {
                    taskRunId: input.taskRunId,
                    error: err instanceof Error ? err.message : String(err),
                  },
                );
              }
            }
          } else {
            log.warn("S3 log truncation returned non-ok status", {
              taskRunId: input.taskRunId,
              status: response.status,
            });
          }
        } catch (err) {
          truncationFailed = true;
          log.warn("Failed to truncate S3 log (non-fatal)", {
            taskRunId: input.taskRunId,
            error: err instanceof Error ? err.message : String(err),
          });
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
        if (orphanedCheckpointIds.length > 0) {
          log.info("Deleted orphaned checkpoint refs", {
            requested: orphanedCheckpointIds.length,
            deleted: idsToDelete.length,
            skippedSurvivors: orphanedCheckpointIds.length - idsToDelete.length,
          });
        }

        // Trim in-memory checkpoints so replayCheckpoints only re-emits
        // survivors — must happen before cancelSession triggers reconnect.
        agentService.truncateCheckpoints(input.taskRunId, input.checkpointId);

        // Mark this taskRunId so the reconnect rebuilds agent memory bounded to
        // the checkpoint: Claude force-refetches the truncated S3 into its JSONL;
        // Codex (no JSONL hydration) starts a FRESH session seeded with a context
        // summary of the truncated conversation (see getOrCreateSession's reconnect
        // path). Must be set before cancelSession triggers the reconnect.
        agentService.markCheckpointRestore(input.taskRunId);

        // Cancel the session — the renderer reconnects and rebuilds bounded memory.
        await agentService.cancelSession(input.taskRunId);
        log.info("Agent session cancelled for checkpoint restore", {
          taskRunId: input.taskRunId,
          checkpointId: input.checkpointId,
        });

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
            log.info("Deleted stale Claude JSONL for checkpoint restore", {
              taskRunId: input.taskRunId,
              sessionId: info.sessionId,
              jsonlPath,
            });
          } catch (err: unknown) {
            // ENOENT is fine — file may already be absent
            const code = (err as NodeJS.ErrnoException).code;
            if (code !== "ENOENT") {
              log.warn("Failed to delete Claude JSONL (non-fatal)", {
                taskRunId: input.taskRunId,
                jsonlPath,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }
        }
      } else {
        log.warn("No active session found for checkpoint restore", {
          taskRunId: input.taskRunId,
        });
      }
    } catch (err) {
      truncationFailed = true;
      log.warn("Failed to truncate agent session", {
        taskRunId: input.taskRunId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  log.info("Checkpoint restore complete", {
    taskRunId: input.taskRunId,
    restoredSessionId,
    truncationFailed,
    adapter: restoredAdapter,
  });
  return { restoredSessionId, truncationFailed, adapter: restoredAdapter };
}
