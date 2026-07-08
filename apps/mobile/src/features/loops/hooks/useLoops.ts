import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/features/auth";
import { logger } from "@/lib/logger";
import {
  createLoop,
  deleteLoop,
  getLoop,
  getLoopRuns,
  listLoops,
  previewLoop,
  runLoop,
  updateLoop,
} from "../api";
import type {
  Loop,
  LoopPreviewRequest,
  LoopWrite,
  PatchedLoop,
} from "../types";

const log = logger.scope("loops-mutations");
const ACTIVE_LOOP_POLLING_INTERVAL_MS = 5_000;
const ACTIVE_LOOP_RUN_STATUSES = new Set([
  "not_started",
  "queued",
  "in_progress",
]);

export const loopKeys = {
  all: ["loops"] as const,
  lists: () => [...loopKeys.all, "list"] as const,
  list: () => [...loopKeys.lists(), "all"] as const,
  details: () => [...loopKeys.all, "detail"] as const,
  detail: (id: string) => [...loopKeys.details(), id] as const,
  runs: (id: string) => [...loopKeys.all, "runs", id] as const,
};

function isActiveLoopStatus(lastRunStatus: string | null): boolean {
  return !!lastRunStatus && ACTIVE_LOOP_RUN_STATUSES.has(lastRunStatus);
}

export function getLoopPollingInterval(
  loopData: Loop | Loop[] | undefined,
): number | false {
  if (!loopData) {
    return false;
  }

  if (Array.isArray(loopData)) {
    return loopData.some((loop) => isActiveLoopStatus(loop.last_run_status))
      ? ACTIVE_LOOP_POLLING_INTERVAL_MS
      : false;
  }

  return isActiveLoopStatus(loopData.last_run_status)
    ? ACTIVE_LOOP_POLLING_INTERVAL_MS
    : false;
}

function invalidateLoopLists(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: loopKeys.lists() });
}

export function useLoops() {
  const { projectId, oauthAccessToken } = useAuthStore();

  const query = useQuery({
    queryKey: loopKeys.list(),
    queryFn: () => listLoops({ limit: 500 }),
    enabled: !!projectId && !!oauthAccessToken,
    refetchInterval: (query) =>
      getLoopPollingInterval(query.state.data?.results),
  });

  const loops = query.data?.results ?? [];

  return {
    loops,
    personalLoops: loops.filter((loop) => loop.visibility === "personal"),
    teamLoops: loops.filter((loop) => loop.visibility === "team"),
    isLoading: query.isLoading,
    error: query.error?.message ?? null,
    refetch: query.refetch,
  };
}

export function useLoop(loopId: string) {
  const { projectId, oauthAccessToken } = useAuthStore();

  return useQuery({
    queryKey: loopKeys.detail(loopId),
    queryFn: () => getLoop(loopId),
    enabled: !!projectId && !!oauthAccessToken && !!loopId,
    refetchInterval: (query) => getLoopPollingInterval(query.state.data),
  });
}

export function useLoopRuns(loopId: string, options: { limit?: number } = {}) {
  const { projectId, oauthAccessToken } = useAuthStore();

  return useQuery({
    queryKey: loopKeys.runs(loopId),
    queryFn: () => getLoopRuns(loopId, { limit: options.limit ?? 50 }),
    enabled: !!projectId && !!oauthAccessToken && !!loopId,
    refetchInterval: (query) =>
      query.state.data?.results.some((run) =>
        ACTIVE_LOOP_RUN_STATUSES.has(run.status),
      )
        ? ACTIVE_LOOP_POLLING_INTERVAL_MS
        : false,
  });
}

export function useCreateLoop() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: LoopWrite) => createLoop(body),
    onSuccess: (loop) => {
      queryClient.setQueryData(loopKeys.detail(loop.id), loop);
      invalidateLoopLists(queryClient);
    },
    onError: (error) => {
      log.error("Failed to create loop", error.message);
    },
  });
}

export function useUpdateLoop() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      loopId,
      updates,
    }: {
      loopId: string;
      updates: PatchedLoop;
    }) => updateLoop(loopId, updates),
    onSuccess: (loop, { loopId }) => {
      queryClient.setQueryData<Loop>(loopKeys.detail(loopId), loop);
      invalidateLoopLists(queryClient);
    },
    onError: (error) => {
      log.error("Failed to update loop", error.message);
    },
  });
}

export function useDeleteLoop() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (loopId: string) => deleteLoop(loopId),
    onSuccess: (_, loopId) => {
      queryClient.removeQueries({ queryKey: loopKeys.detail(loopId) });
      invalidateLoopLists(queryClient);
    },
    onError: (error) => {
      log.error("Failed to delete loop", error.message);
    },
  });
}

export function useRunLoop() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (loopId: string) => runLoop(loopId),
    onSuccess: (_, loopId) => {
      queryClient.invalidateQueries({ queryKey: loopKeys.detail(loopId) });
      queryClient.invalidateQueries({ queryKey: loopKeys.runs(loopId) });
      invalidateLoopLists(queryClient);
    },
    onError: (error) => {
      log.error("Failed to run loop", error.message);
    },
  });
}

export function usePreviewLoop() {
  return useMutation({
    mutationFn: ({
      loopId,
      body,
    }: {
      loopId: string;
      body?: LoopPreviewRequest;
    }) => previewLoop(loopId, body),
    onError: (error) => {
      log.error("Failed to preview loop", error.message);
    },
  });
}
