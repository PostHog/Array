import type {
  CanvasCaptureInput,
  CanvasDataQueryInput,
  CanvasLoadInsightInput,
} from "@posthog/core/canvas/freeformSchemas";
import type { QueryClient } from "@tanstack/react-query";
import { hostClient } from "../hostClient";

// Namespace for every cached canvas read.
export const CANVAS_QUERY_KEY = "canvasData/read";

// Deterministic stringify for cache keys: object keys are emitted in sorted order
// at every depth so two reads that differ only by key order share a cache entry.
// `undefined` and non-finite numbers get distinct tokens — JSON.stringify would
// collapse them all to `null`, so `[undefined]` and `[null]` would wrongly share a
// cache entry (and thus a result).
function stableStringify(value: unknown): string {
  if (value === undefined) return "undef";
  if (value === null) return "null";
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : `num:${String(value)}`;
  }
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    // Positional: keep `undefined` holes distinct from `null`.
    return `[${value.map(stableStringify).join(",")}]`;
  }
  // Object: an absent key and an explicit `undefined` value serialize the same
  // over tRPC, so dropping undefined-valued keys keeps the key in sync with what
  // the server actually receives.
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(",")}}`;
}

// Reads go through the shared QueryClient cache: an iframe re-boot, a canvas
// code-swap, and live edit re-renders all resolve a repeated read from cache
// instead of re-hitting ClickHouse, and concurrent identical reads dedupe. The key
// is content-based (no canvas id) so identical reads across canvases — and across a
// card preview and its full view — share one entry.
function cachedRead<T>(
  queryClient: QueryClient,
  method: string,
  input: unknown,
  run: () => Promise<T>,
) {
  return queryClient.fetchQuery({
    queryKey: [CANVAS_QUERY_KEY, method, stableStringify(input)] as const,
    queryFn: run,
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
  });
}

// Resolves a `ph.*` data-request from a freeform canvas (edit mode). The host
// injects the PostHog token; the iframe only ever sees the result. The QueryClient
// is passed in by the calling component (via useQueryClient) rather than resolved
// here, so this stays a pure function with no host/DI coupling. View/published mode
// (Phase 3) swaps this for a share-token proxy that accepts only `run` of an
// allowlisted named insight.
export async function handleFreeformDataRequest(
  method: string,
  payload: unknown,
  queryClient: QueryClient,
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
      return cachedRead(queryClient, "query", args, () =>
        hostClient().canvasData.query.mutate(args),
      );
    }
    case "loadInsight": {
      const input = payload as CanvasLoadInsightInput;
      if (!input?.shortId || typeof input.shortId !== "string") {
        throw new Error("ph.loadInsight(shortId) requires an insight short id");
      }
      const args = { shortId: input.shortId, dateRange: input.dateRange };
      return cachedRead(queryClient, "loadInsight", args, () =>
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
    case "liveStats":
      // The project's realtime counters (users online, active recordings).
      // A one-shot poll — never cached. The canvas also derives its own
      // sliding-window "users online" count from its live-events stream; this
      // is the server's authoritative counter.
      return hostClient().canvasData.liveStats.query();
    default:
      throw new Error(`Unknown data method "${method}"`);
  }
}

// ---------------------------------------------------------------------------
// Live events — a streaming counterpart to the request/response reads above.
//
// The sandboxed iframe cannot hold the project's `live_events_token` (a
// project-scoped JWT). So `ph.subscribeLiveEvents(params)` posts a
// `live-subscribe` frame here; the renderer asks the host (via tRPC) for the
// brokered connection config (eventsUrl + statsUrl + token), opens the SSE
// stream itself, and fans each parsed event back into the iframe over
// postMessage with `onEvent`. The token only ever lives in THIS renderer
// process — it never crosses the postMessage boundary into the sandbox, and
// it never reaches canvas code (the canvas only sees the event payloads).
// ---------------------------------------------------------------------------
export interface LiveEventsStreamHandle {
  close: () => void;
}

// Builds the `/events` query string from the canvas's subscribe params.
// Mirrors the app's live feed (`liveEventsLogic.tsx`): `eventType`, `distinctId`,
// `columns`, and AND-ed rich `properties` filters (JSON) — the livestream
// service compiles exactly the LIVE_EVENTS_SUPPORTED_OPERATORS allowlist.
export function buildLiveEventsUrl(
  eventsUrl: string,
  params: {
    eventType?: string | null;
    distinctId?: string | null;
    columns?: string[] | null;
    properties?: Array<Record<string, unknown>> | null;
  },
): string {
  const url = new URL(eventsUrl);
  if (params.eventType) url.searchParams.set("eventType", params.eventType);
  if (params.distinctId) url.searchParams.set("distinctId", params.distinctId);
  if (params.columns && params.columns.length > 0) {
    url.searchParams.set("columns", params.columns.join(","));
  }
  if (params.properties && params.properties.length > 0) {
    url.searchParams.set("properties", JSON.stringify(params.properties));
  }
  return url.toString();
}

/**
 * Parse one chunk of SSE wire text into complete `data:`-line payloads and the
 * leftover (incomplete) tail. Pure so it's unit-testable: the stream loop feeds
 * it decoded chunks and keeps the tail for the next chunk.
 */
export function parseSseChunk(chunk: string): {
  payloads: string[];
  tail: string;
} {
  const text = chunk;
  const payloads: string[] = [];
  const lastNewline = text.lastIndexOf("\n");
  const complete = lastNewline === -1 ? "" : text.slice(0, lastNewline + 1);
  const tail = lastNewline === -1 ? text : text.slice(lastNewline + 1);
  for (const line of complete.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("data:")) {
      const payload = trimmed.slice(5).trim();
      if (payload && payload !== "[done]") {
        payloads.push(payload);
      }
    }
  }
  return { payloads, tail };
}

/**
 * Open a live-events SSE stream on behalf of a canvas and deliver each event
 * to `onEvent`. The caller (FreeformCanvas) is responsible for invoking the
 * returned `close()` when the canvas unsubscribes, unmounts, or its iframe
 * reloads — the stream is a live connection, not a one-shot request.
 *
 * Returns a handle synchronously; the connection bootstrap (fetching config,
 * opening the stream) is async and reports failure through `onError` so the
 * canvas can resubscribe.
 */
export function openLiveEventsStream(
  params: {
    eventType?: string | null;
    distinctId?: string | null;
    columns?: string[] | null;
    properties?: Array<Record<string, unknown>> | null;
  },
  onEvent: (event: unknown) => void,
  onError: (message: string) => void,
): LiveEventsStreamHandle {
  const controller = new AbortController();

  void (async () => {
    try {
      const config = await hostClient().canvasData.liveConnectionConfig.query();
      const url = buildLiveEventsUrl(config.eventsUrl, params);
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${config.token}`,
          Accept: "text/event-stream",
        },
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        throw new Error(`Live events stream failed (${response.status})`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let tail = "";
      // Parse the SSE wire format: lines of `data: <json>` separated by blank
      // lines. We only consume the `data:` field (the service emits one JSON
      // event per frame).
      while (true) {
        if (controller.signal.aborted) break;
        const { done, value } = await reader.read();
        if (done) break;
        const { payloads, tail: nextTail } = parseSseChunk(
          tail + decoder.decode(value, { stream: true }),
        );
        tail = nextTail;
        for (const payload of payloads) {
          try {
            onEvent(JSON.parse(payload));
          } catch {
            // Ignore a malformed event rather than killing the stream.
          }
        }
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        onError(err instanceof Error ? err.message : String(err));
      }
    }
  })();

  return {
    close: () => controller.abort(),
  };
}
