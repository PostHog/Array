import { z } from "zod";
import type { IDefaultAdditionalDirectoryRepository } from "../../db/repositories/default-additional-directory-repository";
import type { IWorkspaceRepository } from "../../db/repositories/workspace-repository";
import { container } from "../../di/container";
import { MAIN_TOKENS } from "../../di/tokens";
import { publicProcedure, router } from "../trpc";

const getDefaults = () =>
  container.get<IDefaultAdditionalDirectoryRepository>(
    MAIN_TOKENS.DefaultAdditionalDirectoryRepository,
  );

const getWorkspaces = () =>
  container.get<IWorkspaceRepository>(MAIN_TOKENS.WorkspaceRepository);

const pathInput = z.object({ path: z.string().min(1) });
const taskPathInput = z.object({
  taskId: z.string(),
  path: z.string().min(1),
});
const ok = { ok: true as const };

export const additionalDirectoriesRouter = router({
  listDefaults: publicProcedure
    .output(z.array(z.string()))
    .query(() => getDefaults().list()),

  listForTask: publicProcedure
    .input(z.object({ taskId: z.string() }))
    .output(z.array(z.string()))
    .query(({ input }) =>
      getWorkspaces().getAdditionalDirectories(input.taskId),
    ),

  addDefault: publicProcedure.input(pathInput).mutation(({ input }) => {
    getDefaults().add(input.path);
    return ok;
  }),

  removeDefault: publicProcedure.input(pathInput).mutation(({ input }) => {
    getDefaults().remove(input.path);
    return ok;
  }),

  addForTask: publicProcedure.input(taskPathInput).mutation(({ input }) => {
    getWorkspaces().addAdditionalDirectory(input.taskId, input.path);
    return ok;
  }),

  removeForTask: publicProcedure.input(taskPathInput).mutation(({ input }) => {
    getWorkspaces().removeAdditionalDirectory(input.taskId, input.path);
    return ok;
  }),
});
