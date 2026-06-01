import fs from "node:fs/promises";
import { isNotification, POSTHOG_NOTIFICATIONS } from "@posthog/agent";
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
import { logger } from "../../utils/logger";
import { publicProcedure, router } from "../trpc";

const log = logger.scope("checkpoint-router");

const getAgentService = () =>
  container.get<AgentService>(MAIN_TOKENS.AgentService);

const restoreInput = z.object({
  checkpointId: z.string(),
  repoPath: z.string(),
  taskRunId: z.string().optional(),
});

const restoreOutput = z.object({
  checkpointId: z.string(),
  commit: z.string(),
  head: z.string().nullable(),
  branch: z.string().nullable(),
});

interface TruncateResult {
  truncated: boolean;
  /** Checkpoint IDs that appear in the discarded portion (orphaned refs). */
  orphanedCheckpointIds: string[];
}

/**
 * Truncate a session JSONL file at the turn containing the given checkpoint.
 * Finds the `_posthog/git_checkpoint` entry with matching checkpointId, then
 * includes all entries up to (but not including) the next user message group.
 * Returns orphaned checkpoint IDs from the discarded lines for cleanup.
 */
async function truncateSessionJsonl(
  jsonlPath: string,
  checkpointId: string,
): Promise<TruncateResult> {
  let content: string;
  try {
    content = await fs.readFile(jsonlPath, "utf-8");
  } catch {
    return { truncated: false, orphanedCheckpointIds: [] };
  }

  const lines = content.split("\n").filter((l) => l.trim());
  let checkpointLineIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    try {
      const entry = JSON.parse(lines[i]);
      const method = entry.notification?.method;
      if (!method) continue;
      if (!isNotification(method, POSTHOG_NOTIFICATIONS.GIT_CHECKPOINT))
        continue;
      const params = entry.notification?.params;
      if (params?.checkpointId === checkpointId) {
        checkpointLineIdx = i;
        break;
      }
    } catch {
      // skip malformed lines
    }
  }

  if (checkpointLineIdx === -1)
    return { truncated: false, orphanedCheckpointIds: [] };

  // Find the end of the current turn: scan forward for the next user message
  // group start (a user_message_chunk after non-user content).
  let cutoff = lines.length;
  let inUserMessage = false;
  let passedNonUser = false;

  for (let i = checkpointLineIdx + 1; i < lines.length; i++) {
    try {
      const entry = JSON.parse(lines[i]);
      const method = entry.notification?.method;
      const params = entry.notification?.params as
        | Record<string, unknown>
        | undefined;

      if (method === "session/update" && params?.update) {
        const update = params.update as { sessionUpdate?: string };
        const isUserChunk =
          update.sessionUpdate === "user_message" ||
          update.sessionUpdate === "user_message_chunk";

        if (isUserChunk) {
          if (passedNonUser && !inUserMessage) {
            // Start of a new user message group — stop here
            cutoff = i;
            break;
          }
          inUserMessage = true;
        } else {
          if (inUserMessage) {
            passedNonUser = true;
          }
          inUserMessage = false;
        }
      } else if (method === "session/prompt") {
        // session/prompt request also marks a turn boundary
        cutoff = i;
        break;
      } else {
        if (inUserMessage) {
          passedNonUser = true;
        }
        inUserMessage = false;
      }
    } catch {
      // skip malformed
    }
  }

  // Collect checkpoint IDs from the discarded lines so their refs can be cleaned up
  const orphanedCheckpointIds: string[] = [];
  for (let i = cutoff; i < lines.length; i++) {
    try {
      const entry = JSON.parse(lines[i]);
      const method = entry.notification?.method;
      if (!method) continue;
      if (!isNotification(method, POSTHOG_NOTIFICATIONS.GIT_CHECKPOINT))
        continue;
      const id = entry.notification?.params?.checkpointId;
      if (id) orphanedCheckpointIds.push(id);
    } catch {
      // skip malformed
    }
  }

  const truncatedLines = lines.slice(0, cutoff);
  const tmpPath = `${jsonlPath}.tmp.${Date.now()}`;
  await fs.writeFile(tmpPath, `${truncatedLines.join("\n")}\n`, "utf-8");
  await fs.rename(tmpPath, jsonlPath);

  log.info("Truncated session JSONL", {
    checkpointId,
    originalLines: lines.length,
    truncatedLines: truncatedLines.length,
    orphanedCheckpointIds,
  });
  return { truncated: true, orphanedCheckpointIds };
}

export const checkpointRouter = router({
  restore: publicProcedure
    .input(restoreInput)
    .output(restoreOutput)
    .mutation(async ({ input }) => {
      // 1. Revert git files to checkpoint state
      const saga = new RevertCheckpointSaga();
      const result = await saga.run({
        baseDir: input.repoPath,
        checkpointId: input.checkpointId,
      });
      if (!result.success) {
        throw new Error(result.error ?? "Failed to revert checkpoint");
      }

      // 2. Truncate agent's session JSONL, clean up orphaned checkpoint refs, and restart agent
      if (input.taskRunId) {
        try {
          const agentService = getAgentService();
          const info = agentService.getSessionInfo(input.taskRunId);
          if (info) {
            const jsonlPath = getSessionJsonlPath(
              info.sessionId,
              info.repoPath,
            );
            const { truncated, orphanedCheckpointIds } =
              await truncateSessionJsonl(jsonlPath, input.checkpointId);
            if (truncated) {
              // Delete git refs for checkpoints in the abandoned future turns
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
              // Cancel the agent session — the renderer will automatically
              // reconnect and resume from the truncated JSONL
              await agentService.cancelSession(input.taskRunId);
              log.info("Agent session cancelled for checkpoint restore", {
                taskRunId: input.taskRunId,
                checkpointId: input.checkpointId,
              });
            }
          }
        } catch (err) {
          // Non-fatal: git files were already reverted successfully.
          // The UI will truncate its events regardless.
          log.warn("Failed to truncate agent session", {
            taskRunId: input.taskRunId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      return result;
    }),
});
