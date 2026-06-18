import type { CanvasDataQueryInput } from "@posthog/core/canvas/freeformSchemas";
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
      if (!input?.hogql || typeof input.hogql !== "string") {
        throw new Error("ph.query(hogql) requires a HogQL string");
      }
      return hostClient().canvasData.query.mutate({
        hogql: input.hogql,
        params: input.params,
      });
    }
    case "run":
      // Named, server-stored insights land in Phase 3 (the live published tier).
      throw new Error("ph.run is not available yet (named queries: Phase 3)");
    default:
      throw new Error(`Unknown data method "${method}"`);
  }
}
