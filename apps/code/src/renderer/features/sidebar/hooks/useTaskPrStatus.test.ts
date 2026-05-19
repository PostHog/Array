import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskData } from "./useSidebarData";
import { useTaskPrStatus } from "./useTaskPrStatus";

let queryData: unknown;

vi.mock("@renderer/trpc/client", () => ({
  useTRPC: () => ({
    workspace: {
      getTaskPrStatus: {
        queryOptions: (
          input: { taskId: string; cloudPrUrl: string | null },
          opts: { staleTime: number },
        ) => ({
          queryKey: ["workspace.getTaskPrStatus", input],
          queryFn: () => undefined,
          ...opts,
        }),
      },
    },
  }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: queryData }),
}));

function makeTask(overrides: Partial<TaskData> = {}): TaskData {
  return {
    id: "task-1",
    title: "Test task",
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
    isGenerating: false,
    isUnread: false,
    isPinned: false,
    needsPermission: false,
    repository: null,
    isSuspended: false,
    taskRunEnvironment: "local" as const,
    folderPath: "/repo",
    cloudPrUrl: null,
    branchName: "feat/test",
    linkedBranch: null,
    ...overrides,
  };
}

describe("useTaskPrStatus", () => {
  beforeEach(() => {
    queryData = undefined;
  });

  it("returns empty status when no data is available", () => {
    const { result } = renderHook(() => useTaskPrStatus(makeTask()));
    expect(result.current).toEqual({ prState: null, hasDiff: false });
  });

  it("returns empty status when data has no prState and no diff", () => {
    queryData = { prState: null, hasDiff: false };
    const { result } = renderHook(() => useTaskPrStatus(makeTask()));
    expect(result.current).toEqual({ prState: null, hasDiff: false });
  });

  it("returns prState from query data", () => {
    queryData = { prState: "open", hasDiff: false };
    const { result } = renderHook(() => useTaskPrStatus(makeTask()));
    expect(result.current).toEqual({ prState: "open", hasDiff: false });
  });

  it("returns hasDiff from query data", () => {
    queryData = { prState: null, hasDiff: true };
    const { result } = renderHook(() => useTaskPrStatus(makeTask()));
    expect(result.current).toEqual({ prState: null, hasDiff: true });
  });

  it("returns both prState and hasDiff from query data", () => {
    queryData = { prState: "merged", hasDiff: true };
    const { result } = renderHook(() => useTaskPrStatus(makeTask()));
    expect(result.current).toEqual({ prState: "merged", hasDiff: true });
  });
});
