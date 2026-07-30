import type { Workspace, WorkspaceInfo } from "@posthog/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const WORKSPACE_QUERY_KEY = ["workspace", "getAll"];
const WORKTREES_FILTER = { queryKey: ["worktrees", "/repo"] };

const { createFn, scratchFn } = vi.hoisted(() => ({
  createFn: vi.fn(),
  scratchFn: vi.fn(),
}));

vi.mock("@posthog/host-router/react", () => ({
  useHostTRPC: () => ({
    workspace: {
      getAll: {
        queryKey: () => WORKSPACE_QUERY_KEY,
      },
      listGitWorktrees: {
        queryFilter: () => WORKTREES_FILTER,
      },
      create: {
        mutationOptions: (options: Record<string, unknown>) => ({
          mutationFn: (input: unknown) => createFn(input),
          ...options,
        }),
      },
      delete: {
        mutationOptions: (options: Record<string, unknown>) => ({
          mutationFn: vi.fn(),
          ...options,
        }),
      },
      ensureScratchDir: {
        mutationOptions: (options: Record<string, unknown>) => ({
          mutationFn: (input: unknown) => scratchFn(input),
          ...options,
        }),
      },
    },
  }),
}));

import {
  useEnsureScratchWorkspace,
  useEnsureWorkspace,
} from "./useWorkspaceMutations";

const created = { taskId: "t1", mode: "worktree" } as unknown as WorkspaceInfo;

let queryClient: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("useWorkspaceMutations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    createFn.mockResolvedValue(created);
  });

  it("useEnsureWorkspace returns a cached workspace without calling create", async () => {
    queryClient.setQueryData(WORKSPACE_QUERY_KEY, {
      t1: { taskId: "t1" } as unknown as Workspace,
    });
    const { result } = renderHook(() => useEnsureWorkspace(), { wrapper });

    let out: Workspace | null = null;
    await act(async () => {
      out = await result.current.ensureWorkspace("t1", "/repo");
    });

    expect(out).toEqual({ taskId: "t1" });
    expect(createFn).not.toHaveBeenCalled();
  });

  it("useEnsureWorkspace creates and invalidates the worktrees filter when absent", async () => {
    queryClient.setQueryData(WORKSPACE_QUERY_KEY, {});
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useEnsureWorkspace(), { wrapper });

    await act(async () => {
      await result.current.ensureWorkspace("t1", "/repo", "worktree");
    });

    expect(createFn).toHaveBeenCalledWith({
      taskId: "t1",
      mainRepoPath: "/repo",
      folderId: "",
      folderPath: "/repo",
      mode: "worktree",
      branch: undefined,
    });
    expect(invalidateSpy).toHaveBeenCalledWith(WORKTREES_FILTER);
  });

  it("useEnsureScratchWorkspace provisions the scratch dir and invalidates workspaces", async () => {
    scratchFn.mockResolvedValue({ path: "/scratch/t1" });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useEnsureScratchWorkspace(), {
      wrapper,
    });

    await act(async () => {
      result.current.ensure("t1");
    });

    expect(scratchFn).toHaveBeenCalledExactlyOnceWith({ taskId: "t1" });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: WORKSPACE_QUERY_KEY,
    });
  });

  it("useEnsureScratchWorkspace fires once — later ensure() calls no-op", async () => {
    scratchFn.mockResolvedValue({ path: "/scratch/t1" });
    const { result } = renderHook(() => useEnsureScratchWorkspace(), {
      wrapper,
    });

    await act(async () => {
      result.current.ensure("t1");
    });
    await act(async () => {
      result.current.ensure("t1");
    });

    expect(scratchFn).toHaveBeenCalledTimes(1);
  });

  it("useEnsureScratchWorkspace reports failure without refiring", async () => {
    scratchFn.mockRejectedValue(new Error("disk full"));
    const { result } = renderHook(() => useEnsureScratchWorkspace(), {
      wrapper,
    });

    await act(async () => {
      result.current.ensure("t1");
    });
    await act(async () => {
      result.current.ensure("t1");
    });

    expect(scratchFn).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
