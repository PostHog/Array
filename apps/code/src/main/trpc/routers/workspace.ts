import type { WorkspaceRepository } from "../../db/repositories/workspace-repository";
import { container } from "../../di/container";
import { MAIN_TOKENS } from "../../di/tokens";
import type { GitService } from "../../services/git/service";
import {
  createWorkspaceInput,
  createWorkspaceOutput,
  deleteWorkspaceInput,
  deleteWorktreeInput,
  getAllTaskTimestampsOutput,
  getAllWorkspacesOutput,
  getLocalTasksInput,
  getLocalTasksOutput,
  getPinnedTaskIdsOutput,
  getTaskTimestampsInput,
  getTaskTimestampsOutput,
  getWorkspaceInfoInput,
  getWorkspaceInfoOutput,
  getWorktreeSizeInput,
  getWorktreeSizeOutput,
  getWorktreeTasksInput,
  getWorktreeTasksOutput,
  linkBranchInput,
  listGitWorktreesInput,
  listGitWorktreesOutput,
  markActivityInput,
  markViewedInput,
  taskPrStatusInput,
  taskPrStatusOutput,
  togglePinInput,
  togglePinOutput,
  unlinkBranchInput,
  verifyWorkspaceInput,
  verifyWorkspaceOutput,
} from "../../services/workspace/schemas";
import {
  type WorkspaceService,
  WorkspaceServiceEvent,
  type WorkspaceServiceEvents,
} from "../../services/workspace/service";
import { publicProcedure, router } from "../trpc";

const getService = () =>
  container.get<WorkspaceService>(MAIN_TOKENS.WorkspaceService);

const getGitService = () => container.get<GitService>(MAIN_TOKENS.GitService);

const getWorkspaceRepo = () =>
  container.get<WorkspaceRepository>(MAIN_TOKENS.WorkspaceRepository);

function subscribe<K extends keyof WorkspaceServiceEvents>(event: K) {
  return publicProcedure.subscription(async function* (opts) {
    const service = getService();
    const iterable = service.toIterable(event, { signal: opts.signal });
    for await (const data of iterable) {
      yield data;
    }
  });
}

export const workspaceRouter = router({
  create: publicProcedure
    .input(createWorkspaceInput)
    .output(createWorkspaceOutput)
    .mutation(({ input }) => getService().createWorkspace(input)),

  delete: publicProcedure
    .input(deleteWorkspaceInput)
    .mutation(({ input }) =>
      getService().deleteWorkspace(input.taskId, input.mainRepoPath),
    ),

  verify: publicProcedure
    .input(verifyWorkspaceInput)
    .output(verifyWorkspaceOutput)
    .query(({ input }) => getService().verifyWorkspaceExists(input.taskId)),

  getInfo: publicProcedure
    .input(getWorkspaceInfoInput)
    .output(getWorkspaceInfoOutput)
    .query(({ input }) => getService().getWorkspaceInfo(input.taskId)),

  getAll: publicProcedure
    .output(getAllWorkspacesOutput)
    .query(() => getService().getAllWorkspaces()),

  getLocalTasks: publicProcedure
    .input(getLocalTasksInput)
    .output(getLocalTasksOutput)
    .query(({ input }) =>
      getService().getLocalTasksForFolder(input.mainRepoPath),
    ),

  getWorktreeTasks: publicProcedure
    .input(getWorktreeTasksInput)
    .output(getWorktreeTasksOutput)
    .query(({ input }) => getService().getWorktreeTasks(input.worktreePath)),

  listGitWorktrees: publicProcedure
    .input(listGitWorktreesInput)
    .output(listGitWorktreesOutput)
    .query(({ input }) => getService().listGitWorktrees(input.mainRepoPath)),

  getWorktreeSize: publicProcedure
    .input(getWorktreeSizeInput)
    .output(getWorktreeSizeOutput)
    .query(({ input }) => getService().getWorktreeSize(input.worktreePath)),

  deleteWorktree: publicProcedure
    .input(deleteWorktreeInput)
    .mutation(({ input }) =>
      getService().deleteWorktree(input.mainRepoPath, input.worktreePath),
    ),

  togglePin: publicProcedure
    .input(togglePinInput)
    .output(togglePinOutput)
    .mutation(({ input }) => {
      const repo = getWorkspaceRepo();
      const workspace = repo.findByTaskId(input.taskId);
      if (!workspace) {
        return { isPinned: false, pinnedAt: null };
      }
      const newPinnedAt = workspace.pinnedAt ? null : new Date().toISOString();
      repo.updatePinnedAt(input.taskId, newPinnedAt);
      return { isPinned: newPinnedAt !== null, pinnedAt: newPinnedAt };
    }),

  markViewed: publicProcedure.input(markViewedInput).mutation(({ input }) => {
    const repo = getWorkspaceRepo();
    repo.updateLastViewedAt(input.taskId, new Date().toISOString());
  }),

  markActivity: publicProcedure
    .input(markActivityInput)
    .mutation(({ input }) => {
      const repo = getWorkspaceRepo();
      const workspace = repo.findByTaskId(input.taskId);
      const lastViewedAt = workspace?.lastViewedAt
        ? new Date(workspace.lastViewedAt).getTime()
        : 0;
      const now = Date.now();
      const activityTime = Math.max(now, lastViewedAt + 1);
      repo.updateLastActivityAt(
        input.taskId,
        new Date(activityTime).toISOString(),
      );
    }),

  getPinnedTaskIds: publicProcedure.output(getPinnedTaskIdsOutput).query(() => {
    const repo = getWorkspaceRepo();
    return repo.findAllPinned().map((w) => w.taskId);
  }),

  getTaskTimestamps: publicProcedure
    .input(getTaskTimestampsInput)
    .output(getTaskTimestampsOutput)
    .query(({ input }) => {
      const repo = getWorkspaceRepo();
      const workspace = repo.findByTaskId(input.taskId);
      return {
        pinnedAt: workspace?.pinnedAt ?? null,
        lastViewedAt: workspace?.lastViewedAt ?? null,
        lastActivityAt: workspace?.lastActivityAt ?? null,
      };
    }),

  getAllTaskTimestamps: publicProcedure
    .output(getAllTaskTimestampsOutput)
    .query(() => {
      const repo = getWorkspaceRepo();
      const workspaces = repo.findAll();
      const result: Record<
        string,
        {
          pinnedAt: string | null;
          lastViewedAt: string | null;
          lastActivityAt: string | null;
        }
      > = {};
      for (const w of workspaces) {
        result[w.taskId] = {
          pinnedAt: w.pinnedAt,
          lastViewedAt: w.lastViewedAt,
          lastActivityAt: w.lastActivityAt,
        };
      }
      return result;
    }),

  linkBranch: publicProcedure
    .input(linkBranchInput)
    .mutation(({ input }) =>
      getService().linkBranch(input.taskId, input.branchName, "user"),
    ),

  unlinkBranch: publicProcedure
    .input(unlinkBranchInput)
    .mutation(({ input }) => getService().unlinkBranch(input.taskId, "user")),

  getTaskPrStatus: publicProcedure
    .input(taskPrStatusInput)
    .output(taskPrStatusOutput)
    .query(({ input }) =>
      getGitService().getTaskPrStatus(input.taskId, input.cloudPrUrl),
    ),

  onError: subscribe(WorkspaceServiceEvent.Error),
  onWarning: subscribe(WorkspaceServiceEvent.Warning),
  onPromoted: subscribe(WorkspaceServiceEvent.Promoted),
  onBranchChanged: subscribe(WorkspaceServiceEvent.BranchChanged),
  onLinkedBranchChanged: subscribe(WorkspaceServiceEvent.LinkedBranchChanged),
});
