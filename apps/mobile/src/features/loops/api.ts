import {
  buildApiFetcher,
  createApiClient,
  createLoop as createLoopRequest,
  destroyLoop as destroyLoopRequest,
  listLoopRuns as listLoopRunsRequest,
  listLoops as listLoopsRequest,
  partialUpdateLoop as partialUpdateLoopRequest,
  previewLoop as previewLoopRequest,
  retrieveLoop as retrieveLoopRequest,
  runLoop as runLoopRequest,
  triggerLoop as triggerLoopRequest,
} from "@posthog/api-client";
import Constants from "expo-constants";
import { useAuthStore } from "@/features/auth";
import { getAccessToken, getBaseUrl, getProjectId } from "@/lib/api";
import type {
  Loop,
  LoopFireRun,
  LoopPreview,
  LoopPreviewRequest,
  LoopRunPage,
  LoopWrite,
  PaginatedLoopList,
  PatchedLoop,
} from "./types";

const APP_VERSION = Constants.expoConfig?.version ?? "unknown";

// Loops are wired through the shared `@posthog/api-client` package (the
// same generated client the desktop app uses) rather than the hand-rolled
// `authedFetch` helper the rest of the mobile tasks feature uses — this is
// the one API surface that isn't hand-duplicated per host.
function getLoopsClient() {
  const fetcher = buildApiFetcher({
    getAccessToken: async () => getAccessToken(),
    refreshAccessToken: async () => {
      await useAuthStore.getState().refreshAccessToken();
      return getAccessToken();
    },
    appVersion: APP_VERSION,
  });
  return createApiClient(fetcher, getBaseUrl());
}

function loopsProjectId(): string {
  return String(getProjectId());
}

export async function listLoops(query?: {
  limit?: number;
  offset?: number;
}): Promise<PaginatedLoopList> {
  return listLoopsRequest(getLoopsClient(), loopsProjectId(), query);
}

export async function getLoop(loopId: string): Promise<Loop> {
  return retrieveLoopRequest(getLoopsClient(), loopsProjectId(), loopId);
}

export async function createLoop(body: LoopWrite): Promise<Loop> {
  return createLoopRequest(getLoopsClient(), loopsProjectId(), body);
}

export async function updateLoop(
  loopId: string,
  body: PatchedLoop,
): Promise<Loop> {
  return partialUpdateLoopRequest(
    getLoopsClient(),
    loopsProjectId(),
    loopId,
    body,
  );
}

export async function deleteLoop(loopId: string): Promise<void> {
  return destroyLoopRequest(getLoopsClient(), loopsProjectId(), loopId);
}

export async function runLoop(
  loopId: string,
  idempotencyKey?: string,
): Promise<LoopFireRun> {
  return runLoopRequest(
    getLoopsClient(),
    loopsProjectId(),
    loopId,
    idempotencyKey,
  );
}

export async function triggerLoop(
  loopId: string,
  payload: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<LoopFireRun> {
  return triggerLoopRequest(
    getLoopsClient(),
    loopsProjectId(),
    loopId,
    payload,
    idempotencyKey,
  );
}

export async function getLoopRuns(
  loopId: string,
  query?: { cursor?: string; limit?: number },
): Promise<LoopRunPage> {
  return listLoopRunsRequest(getLoopsClient(), loopsProjectId(), loopId, query);
}

export async function previewLoop(
  loopId: string,
  body?: LoopPreviewRequest,
): Promise<LoopPreview> {
  return previewLoopRequest(getLoopsClient(), loopsProjectId(), loopId, body);
}
