import { truncateCodexRollout } from "@posthog/agent/adapters/codex/rollout";
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

const getAgentService = () =>
  container.get<AgentService>(MAIN_TOKENS.AgentService);

const getAuthService = () =>
  container.get<AuthService>(MAIN_TOKENS.AuthService);

const getLocalLogsService = () =>
  container.get<LocalLogsService>(MAIN_TOKENS.LocalLogsService);

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
    if (input.taskRunId) {
      try {
        const agentService = getAgentService();
        const info = agentService.getSessionInfo(input.taskRunId);
        if (info) {
          restoredSessionId = info.sessionId;
          let orphanedCheckpointIds: string[] = [];

          // Truncate S3 + local cache BEFORE cancelling the session.
          // cancelSession triggers reconnect; if reconnect reads local cache
          // before truncation, the stale full history would be loaded.
          try {
            const authService = getAuthService();
            const url = `${info.apiHost}/api/projects/${info.projectId}/tasks/${info.taskId}/runs/${input.taskRunId}/truncate_log/`;
            const promptId = agentService.getCheckpointPromptId(
              input.taskRunId,
              input.checkpointId,
            );
            const response = await authService.authenticatedFetch(fetch, url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                checkpoint_id: input.checkpointId,
                prompt_id: promptId,
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
                promptId,
                truncated: s3Result.truncated,
                originalLines: s3Result.original_line_count,
                truncatedLines: s3Result.truncated_line_count,
                orphanedCheckpoints: s3Result.orphaned_checkpoint_ids,
              });
              const localLogsSvc = getLocalLogsService();
              if (s3Result.truncated) {
                orphanedCheckpointIds = s3Result.orphaned_checkpoint_ids ?? [];
                // Coarse trim: align local cache with the S3 line count.
                await localLogsSvc
                  .truncateLocalLogs(
                    input.taskRunId,
                    s3Result.truncated_line_count,
                  )
                  .catch((err: unknown) => {
                    log.warn("Failed to truncate local log cache (non-fatal)", {
                      taskRunId: input.taskRunId,
                      error: err instanceof Error ? err.message : String(err),
                    });
                  });
              } else {
                log.warn(
                  "S3 log was not truncated — will rely on client-side prompt-boundary trim",
                  {
                    taskRunId: input.taskRunId,
                    checkpointId: input.checkpointId,
                    promptId,
                  },
                );
              }
              // Fine-trim to the exact prompt boundary regardless of S3 result.
              // This is the primary defense for Codex sessions (all events are
              // type:"notification", so the backend may not find turn boundaries).
              // Cancel any in-flight drain first so our write wins.
              localLogsSvc.cancelPendingWrite(input.taskRunId);
              await localLogsSvc
                .truncateLocalLogsAtPromptBoundary(
                  input.taskRunId,
                  promptId ?? -1,
                )
                .catch((err: unknown) => {
                  log.warn(
                    "Failed to truncate local logs at prompt boundary (non-fatal)",
                    {
                      taskRunId: input.taskRunId,
                      error: err instanceof Error ? err.message : String(err),
                    },
                  );
                });
            } else {
              log.warn("S3 log truncation returned non-ok status", {
                taskRunId: input.taskRunId,
                status: response.status,
              });
            }
          } catch (err) {
            log.warn("Failed to truncate S3 log (non-fatal)", {
              taskRunId: input.taskRunId,
              error: err instanceof Error ? err.message : String(err),
            });
          }

          // Clean up git refs for orphaned checkpoints
          if (orphanedCheckpointIds.length > 0) {
            const git = createGitClient(input.repoPath);
            await Promise.all(
              orphanedCheckpointIds.map((id) =>
                deleteCheckpoint(git, id).catch(() => {}),
              ),
            );
            log.info("Deleted orphaned checkpoint refs", {
              orphanedCheckpointIds,
            });
          }

          // Trim in-memory checkpoints so replayCheckpoints only re-emits
          // survivors — must happen before cancelSession triggers reconnect.
          // Returns the number of surviving turns (used as keepTurns for Codex).
          const survivingTurns = agentService.truncateCheckpoints(
            input.taskRunId,
            input.checkpointId,
          );

          // Mark this taskRunId so hydrateSessionJsonl force-refetches from
          // the truncated S3 on reconnect, bypassing any stale existing JSONL.
          // Must be set before cancelSession triggers the reconnect.
          agentService.markCheckpointRestore(input.taskRunId);

          // Cancel the session — renderer reconnects, hydrateSessionJsonl
          // fetches the truncated S3 log and overwrites the stale JSONL.
          await agentService.cancelSession(input.taskRunId);
          log.info("Agent session cancelled for checkpoint restore", {
            taskRunId: input.taskRunId,
            checkpointId: input.checkpointId,
          });

          // For Codex: truncate the on-disk rollout AFTER the subprocess is
          // killed (file is now closed) so the resumed session has memory only
          // up to the checkpoint. Must happen after cancelSession.
          // survivingTurns=0 means the checkpoint wasn't found — skip truncation.
          log.info("Checkpoint restore rollout decision", {
            taskRunId: input.taskRunId,
            adapter: info.adapter,
            sessionId: info.sessionId,
            survivingTurns,
          });
          if (info.adapter === "codex" && survivingTurns > 0) {
            await truncateCodexRollout(
              info.sessionId,
              survivingTurns,
              log,
            ).catch((err: unknown) => {
              log.warn("Failed to truncate codex rollout (non-fatal)", {
                taskRunId: input.taskRunId,
                sessionId: info.sessionId,
                error: err instanceof Error ? err.message : String(err),
              });
            });
          }
        } else {
          log.warn("No active session found for checkpoint restore", {
            taskRunId: input.taskRunId,
          });
        }
      } catch (err) {
        log.warn("Failed to truncate agent session", {
          taskRunId: input.taskRunId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    log.info("Checkpoint restore complete", {
      taskRunId: input.taskRunId,
      restoredSessionId,
    });
    return { restoredSessionId };
  }),
});
