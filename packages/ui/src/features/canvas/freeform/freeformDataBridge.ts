import type {
  CanvasCaptureInput,
  CanvasDataQueryInput,
  CanvasLoadInsightInput,
} from "@posthog/core/canvas/freeformSchemas";
import { hostClient } from "../hostClient";

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
      return hostClient().canvasData.query.mutate({
        query: input.query,
        hogql: input.hogql,
        params: input.params,
      });
    }
    case "loadInsight": {
      const input = payload as CanvasLoadInsightInput;
      if (!input?.shortId || typeof input.shortId !== "string") {
        throw new Error("ph.loadInsight(shortId) requires an insight short id");
      }
      return hostClient().canvasData.loadInsight.mutate({
        shortId: input.shortId,
        dateRange: input.dateRange,
      });
    }
    case "capture": {
      const input = payload as CanvasCaptureInput;
      if (!input?.event || typeof input.event !== "string") {
        throw new Error("ph.capture(event) requires an event name");
      }
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
