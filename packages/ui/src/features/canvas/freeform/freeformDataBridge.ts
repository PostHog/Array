import type {
  CanvasCaptureInput,
  CanvasDataQueryInput,
  CanvasLoadInsightInput,
} from "@posthog/core/canvas/freeformSchemas";
import { resolveService } from "@posthog/di/container";
import {
  IMPERATIVE_QUERY_CLIENT,
  type ImperativeQueryClient,
} from "@posthog/ui/shell/queryClient";
import { hostClient } from "../hostClient";

// Namespace for every cached canvas read. Exported so the refresh path can
// invalidate the whole namespace when the user forces a refresh.
export const CANVAS_QUERY_KEY = "canvasData/read";

// Deterministic stringify: object keys are emitted in sorted order at every
// depth so two reads that differ only by key order share a cache entry (and a
// re-render with the same query is a cache hit, not a fresh backend round-trip).
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(",")}}`;
}

// Reads go through the shared QueryClient cache: an iframe re-boot, a canvas
// code-swap, and live edit re-renders all resolve a repeated read from cache
// instead of re-hitting ClickHouse, and concurrent identical reads dedupe. A
// forced refresh invalidates CANVAS_QUERY_KEY to bypass it.
function cachedRead<T>(method: string, input: unknown, run: () => Promise<T>) {
  return resolveService<ImperativeQueryClient>(
    IMPERATIVE_QUERY_CLIENT,
  ).fetchQuery({
    queryKey: [CANVAS_QUERY_KEY, method, stableStringify(input)] as const,
    queryFn: run,
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
  });
}

// Resolves a `ph.*` data-request from a freeform canvas (edit mode). The host
// injects the PostHog token; the iframe only ever sees the result. View/published
// mode (Phase 3) swaps this for a share-token proxy that accepts only `run` of an
// allowlisted named insight.
export async function handleFreeformDataRequest(
  method: string,
  payload: unknown,
): Promise<unknown> {
  switch (method) {
    case "query": {
      const input = payload as CanvasDataQueryInput;
      const hasQuery = input?.query != null && typeof input.query === "object";
      const hasHogql =
        typeof input?.hogql === "string" && input.hogql.length > 0;
      if (!hasQuery && !hasHogql) {
        throw new Error(
          "ph.query requires a typed query node or a HogQL string",
        );
      }
      const args = {
        query: input.query,
        hogql: input.hogql,
        params: input.params,
      };
      return cachedRead("query", args, () =>
        hostClient().canvasData.query.mutate(args),
      );
    }
    case "loadInsight": {
      const input = payload as CanvasLoadInsightInput;
      if (!input?.shortId || typeof input.shortId !== "string") {
        throw new Error("ph.loadInsight(shortId) requires an insight short id");
      }
      const args = { shortId: input.shortId, dateRange: input.dateRange };
      return cachedRead("loadInsight", args, () =>
        hostClient().canvasData.loadInsight.mutate(args),
      );
    }
    case "capture": {
      const input = payload as CanvasCaptureInput;
      if (!input?.event || typeof input.event !== "string") {
        throw new Error("ph.capture(event) requires an event name");
      }
      // A side-effect, never cached.
      return hostClient().canvasData.capture.mutate({
        event: input.event,
        distinctId: input.distinctId,
        properties: input.properties,
      });
    }
    case "run":
      // Named, server-stored insights land in Phase 3 (the live published tier).
      throw new Error("ph.run is not available yet (named queries: Phase 3)");
    default:
      throw new Error(`Unknown data method "${method}"`);
  }
}
