import type {
  Workspace,
  WorkspaceMode,
} from "@main/services/workspace/schemas";
import { trpcClient, useTRPC } from "@renderer/trpc/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

function useWorkspacesQuery() {
  const trpcReact = useTRPC();
  return useQuery(
    trpcReact.workspace.getAll.queryOptions(undefined, {
      staleTime: 1000 * 60,
    }),
  );
}

function useInvalidateWorkspaceCaches() {
  const trpcReact = useTRPC();
  const queryClient = useQueryClient();
  return useCallback(
    async (mainRepoPath?: string) => {
      const tasks: Promise<void>[] = [
        queryClient.invalidateQueries(trpcReact.workspace.getAll.pathFilter()),
      ];
      if (mainRepoPath) {
        tasks.push(
          queryClient.invalidateQueries(
            trpcReact.workspace.listGitWorktrees.queryFilter({ mainRepoPath }),
          ),
        );
      }
      await Promise.all(tasks);
    },
    [queryClient, trpcReact],
  );
}

export function useWorkspaces(): {
  data: Record<string, Workspace> | undefined;
  isFetched: boolean;
} {
  const query = useWorkspacesQuery();
  return { data: query.data, isFetched: query.isFetched };
}

export function useWorkspace(taskId: string | undefined): Workspace | null {
  const { data: workspaces } = useWorkspacesQuery();
  return useMemo(
    () => workspaces?.[taskId ?? ""] ?? null,
    [workspaces, taskId],
  );
}

export function useIsWorkspaceCloudRun(taskId: string | undefined): boolean {
  const workspace = useWorkspace(taskId);
  return workspace?.mode === "cloud";
}

export function useWorkspaceLoaded(): boolean {
  const { isFetched } = useWorkspacesQuery();
  return isFetched;
}

export function useCreateWorkspace(): { isPending: boolean } {
  const trpcReact = useTRPC();
  const invalidateCaches = useInvalidateWorkspaceCaches();

  const mutation = useMutation(
    trpcReact.workspace.create.mutationOptions({
      onSuccess: (_data, variables) => {
        void invalidateCaches(variables.mainRepoPath);
      },
    }),
  );

  return { isPending: mutation.isPending };
}

export function useDeleteWorkspace(): { isPending: boolean } {
  const trpcReact = useTRPC();
  const invalidateCaches = useInvalidateWorkspaceCaches();

  const mutation = useMutation(
    trpcReact.workspace.delete.mutationOptions({
      onSuccess: (_data, variables) => {
        void invalidateCaches(variables.mainRepoPath);
      },
    }),
  );

  return { isPending: mutation.isPending };
}

export function useEnsureWorkspace(): {
  ensureWorkspace: (
    taskId: string,
    repoPath: string,
    mode?: WorkspaceMode,
    branch?: string | null,
  ) => Promise<Workspace | null>;
  isCreating: boolean;
} {
  const trpcReact = useTRPC();
  const queryClient = useQueryClient();
  const invalidateCaches = useInvalidateWorkspaceCaches();

  const createMutation = useMutation(
    trpcReact.workspace.create.mutationOptions({
      onSuccess: (_data, variables) => {
        void invalidateCaches(variables.mainRepoPath);
      },
    }),
  );

  const ensureWorkspace = useCallback(
    async (
      taskId: string,
      repoPath: string,
      mode: WorkspaceMode = "worktree",
      branch?: string | null,
    ): Promise<Workspace | null> => {
      const existing = queryClient.getQueryData(
        trpcReact.workspace.getAll.queryKey(),
      )?.[taskId];
      if (existing) {
        return existing;
      }

      const result = await createMutation.mutateAsync({
        taskId,
        mainRepoPath: repoPath,
        folderId: "",
        folderPath: repoPath,
        mode,
        branch: branch ?? undefined,
      });

      if (!result) {
        throw new Error("Failed to create workspace");
      }

      await invalidateCaches(repoPath);
      return (
        queryClient.getQueryData(trpcReact.workspace.getAll.queryKey())?.[
          taskId
        ] ?? null
      );
    },
    [createMutation, queryClient, trpcReact, invalidateCaches],
  );

  return {
    ensureWorkspace,
    isCreating: createMutation.isPending,
  };
}

export const workspaceApi = {
  async getAll(): Promise<Record<string, Workspace>> {
    return (await trpcClient.workspace.getAll.query()) ?? {};
  },

  async get(taskId: string): Promise<Workspace | null> {
    const workspaces = await trpcClient.workspace.getAll.query();
    return workspaces?.[taskId] ?? null;
  },

  async create(options: {
    taskId: string;
    mainRepoPath: string;
    folderId: string;
    folderPath: string;
    mode: WorkspaceMode;
    branch?: string;
  }) {
    return trpcClient.workspace.create.mutate(options);
  },

  async reconcileCloudWorkspaces(
    taskIds: string[],
  ): Promise<{ created: string[] }> {
    return trpcClient.workspace.reconcileCloudWorkspaces.mutate({ taskIds });
  },

  async delete(taskId: string, mainRepoPath: string) {
    return trpcClient.workspace.delete.mutate({ taskId, mainRepoPath });
  },

  async verify(taskId: string) {
    return trpcClient.workspace.verify.query({ taskId });
  },
};
