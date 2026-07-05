import { publicProcedure, router } from "@posthog/host-trpc/trpc";
import { CHECKPOINT_SERVICE } from "@posthog/workspace-server/services/checkpoint/identifiers";
import type { CheckpointService } from "@posthog/workspace-server/services/checkpoint/service";
import { z } from "zod";

const restoreInput = z.object({
  checkpointId: z.string(),
  repoPath: z.string(),
  taskRunId: z.string().optional(),
});

export const checkpointRouter = router({
  /**
   * Re-emit stored checkpoint notifications for a session through the existing
   * SessionEvent channel so the renderer receives them after a reconnect.
   */
  replayCheckpoints: publicProcedure
    .input(z.object({ taskRunId: z.string() }))
    .mutation(({ ctx, input }) =>
      ctx.container
        .get<CheckpointService>(CHECKPOINT_SERVICE)
        .replayCheckpoints(input.taskRunId),
    ),

  restore: publicProcedure
    .input(restoreInput)
    .mutation(({ ctx, input }) =>
      ctx.container.get<CheckpointService>(CHECKPOINT_SERVICE).restore(input),
    ),
});
