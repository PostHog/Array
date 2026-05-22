import { z } from "zod";
import type { IForkRelationshipRepository } from "../../db/repositories/fork-relationship-repository";
import { container } from "../../di/container";
import { MAIN_TOKENS } from "../../di/tokens";
import type { ForkService } from "../../services/fork/service";
import { publicProcedure, router } from "../trpc";

const getForkService = () =>
  container.get<ForkService>(MAIN_TOKENS.ForkService);
const getForkRepo = () =>
  container.get<IForkRelationshipRepository>(
    MAIN_TOKENS.ForkRelationshipRepository,
  );

const prepareForkInput = z.object({
  sourceTaskId: z.string(),
  sourceTaskRunId: z.string(),
  sourceTaskTitle: z.string(),
  forkAtMessageIndex: z.number().int().nonnegative(),
  newTaskId: z.string(),
  newTaskRunId: z.string(),
  sourceWorktreePath: z.string(),
  mainRepoPath: z.string(),
  apiHost: z.string(),
  projectId: z.number(),
  model: z.string().optional(),
});

const prepareForkOutput = z.object({
  newWorktreePath: z.string(),
  newSessionId: z.string(),
});

const forkRelationshipOutput = z
  .object({
    forkedTaskId: z.string(),
    sourceTaskId: z.string(),
    sourceTaskRunId: z.string(),
    sourceTaskTitle: z.string(),
    forkAtMessageIndex: z.number(),
    forkedAt: z.string(),
  })
  .nullable();

export const forkRouter = router({
  prepareFork: publicProcedure
    .input(prepareForkInput)
    .output(prepareForkOutput)
    .mutation(({ input }) => getForkService().prepareFork(input)),

  getForkRelationship: publicProcedure
    .input(z.object({ taskId: z.string() }))
    .output(forkRelationshipOutput)
    .query(({ input }) => {
      const rel = getForkRepo().findByForkedTaskId(input.taskId);
      if (!rel) return null;
      return {
        forkedTaskId: rel.forkedTaskId,
        sourceTaskId: rel.sourceTaskId,
        sourceTaskRunId: rel.sourceTaskRunId,
        sourceTaskTitle: rel.sourceTaskTitle,
        forkAtMessageIndex: rel.forkAtMessageIndex,
        forkedAt: rel.forkedAt,
      };
    }),
});
