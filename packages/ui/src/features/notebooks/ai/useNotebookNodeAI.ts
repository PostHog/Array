import {
  type NotebookNodeAIChange,
  NotebookNodeAIService,
  notebookNodeAICacheKey,
} from "@posthog/core/notebooks/notebookNodeAIService";
import {
  type NotebookNodeJsonObject,
  summarizeNotebookNodeLocally,
} from "@posthog/core/notebooks/notebookNodeSummary";
import { useService } from "@posthog/di/react";
import { useOptionalAuthenticatedClient } from "@posthog/ui/features/auth/authClient";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

export interface NotebookNodeAISummaryState {
  /** Best summary available right now (AI → streaming partial → local). */
  summary: string;
  /** True once the text comes from the model (partial or final). */
  isAISummary: boolean;
  isStreaming: boolean;
  hasClient: boolean;
}

/**
 * AI summary for a node's current props: the deterministic local summary
 * renders instantly, the (cached) AI summary streams in over it.
 */
export function useNotebookNodeAISummary(
  tagName: string,
  props: NotebookNodeJsonObject,
): NotebookNodeAISummaryState {
  const client = useOptionalAuthenticatedClient();
  const service = useService(NotebookNodeAIService);
  const cacheKey = notebookNodeAICacheKey({ tagName, props });
  const [partial, setPartial] = useState<string | null>(null);

  // A new props state means the streamed text belongs to a stale node state.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset keyed on the node-state hash
  useEffect(() => setPartial(null), [cacheKey]);

  const cached = service.getCachedSummary({ tagName, props });
  const query = useQuery({
    queryKey: ["notebook-node-ai-summary", cacheKey],
    // Deliberately NOT wired to the query's abort signal: the service
    // coalesces concurrent calls onto one shared promise (and caches the
    // result), so StrictMode's double-mount abort — or closing the panel —
    // must not kill the call for the surviving subscriber.
    queryFn: () => {
      if (!client) throw new Error("Not authenticated");
      return service.summarizeNode(
        client,
        { tagName, props },
        { onPartial: setPartial },
      );
    },
    enabled: client !== null,
    staleTime: Number.POSITIVE_INFINITY,
    retry: 0,
  });

  // Pure and cheap — no memo needed, and it stays correct as props change.
  const localSummary = summarizeNotebookNodeLocally(tagName, props);

  const aiSummary = query.data ?? cached ?? partial;
  return {
    summary: aiSummary || localSummary,
    isAISummary: Boolean(aiSummary),
    isStreaming: client !== null && query.isFetching,
    hasClient: client !== null,
  };
}

/**
 * Mutation applying a natural-language change request to a node. One model
 * call returns both replacement props and the new summary.
 */
export function useNotebookNodeAIChange(tagName: string) {
  const client = useOptionalAuthenticatedClient();
  const service = useService(NotebookNodeAIService);

  return useMutation<
    NotebookNodeAIChange,
    Error,
    { props: NotebookNodeJsonObject; request: string }
  >({
    mutationFn: ({ props, request }) => {
      if (!client) throw new Error("Not authenticated");
      return service.requestNodeChange(client, { tagName, props }, request);
    },
  });
}
