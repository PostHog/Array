// EXPERIMENT (shared-widgets): renders the REAL PostHog webapp query editor
// (InsightViz editor filters: series, taxonomic pickers, breakdown, date range,
// chart type) as the edit UI for notebook Query nodes. The editor runs in the
// same document inside a shadow root with its own React copy — no iframe.
import { useHostTRPCClient } from "@posthog/host-router/react";
import { getCloudUrlFromRegion } from "@posthog/shared";
import type { JSX } from "react";
import { useEffect, useRef, useState } from "react";
import { useAuthStateValue } from "../../auth/store";
import { useThemeStore } from "../../../shell/themeStore";
import type {
  NotebookComponentRenderProps,
  NotebookPropValue,
} from "../markdown-notebook/types";
import {
  getNotebookWidgetsUrl,
  loadPostHogWidgets,
  type QueryEditorWidgetHandle,
} from "./widgetLoader";

// Bare insight query kinds that the InsightViz editor edits — wrap them so the
// widget always receives a renderable top-level node.
const INSIGHT_SOURCE_KINDS = new Set([
  "TrendsQuery",
  "FunnelsQuery",
  "RetentionQuery",
  "PathsQuery",
  "StickinessQuery",
  "LifecycleQuery",
  "CalendarHeatmapQuery",
]);

function toEditorQuery(query: unknown): Record<string, unknown> | null {
  if (!query || typeof query !== "object") {
    return null;
  }
  const node = query as Record<string, unknown>;
  if (typeof node.kind !== "string") {
    return null;
  }
  if (INSIGHT_SOURCE_KINDS.has(node.kind)) {
    return { kind: "InsightVizNode", source: node };
  }
  return node;
}

/** True when the widget wrapped the stored query in an InsightVizNode. */
function wasWrapped(stored: unknown, editorQuery: Record<string, unknown>) {
  return (
    !!stored &&
    typeof stored === "object" &&
    (stored as Record<string, unknown>).kind !== "InsightVizNode" &&
    editorQuery.kind === "InsightVizNode"
  );
}

export function QueryWidgetEdit({
  node,
  updateProps,
}: NotebookComponentRenderProps): JSX.Element {
  const hostClient = useHostTRPCClient();
  const authState = useAuthStateValue((state) => state);
  const isDarkMode = useThemeStore((state) => state.isDarkMode);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<QueryEditorWidgetHandle | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Keep the latest updateProps reachable from the long-lived widget callback.
  const updatePropsRef = useRef(updateProps);
  updatePropsRef.current = updateProps;

  const cloudRegion =
    authState.status === "authenticated" ? authState.cloudRegion : null;

  // Mount once per node/auth change; interim query edits flow back out through
  // onQueryChange (re-mounting on every props.query echo would churn the widget).
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional mount-once semantics
  useEffect(() => {
    const el = containerRef.current;
    const widgetsUrl = getNotebookWidgetsUrl();
    if (!el || !widgetsUrl) {
      return;
    }
    if (!cloudRegion) {
      setError("Sign in to PostHog to edit queries.");
      return;
    }

    const storedQuery = node.props.query;
    const editorQuery = toEditorQuery(storedQuery);
    if (!editorQuery) {
      setError("This node has no editable query.");
      return;
    }
    const unwrap = wasWrapped(storedQuery, editorQuery);

    let cancelled = false;
    loadPostHogWidgets(widgetsUrl)
      .then((api) => {
        if (cancelled || !containerRef.current) {
          return;
        }
        handleRef.current = api.mountQueryEditor(el, {
          query: editorQuery,
          onQueryChange: (nextQuery) => {
            // Store back in the shape the node originally used.
            const next =
              unwrap && nextQuery.kind === "InsightVizNode"
                ? (nextQuery.source as Record<string, unknown>)
                : nextQuery;
            updatePropsRef.current({
              query: next as unknown as NotebookPropValue,
            });
          },
          apiHost: getCloudUrlFromRegion(cloudRegion),
          getAccessToken: () =>
            hostClient.auth.getValidAccessToken
              .query()
              .then((result) => result.accessToken),
          theme: isDarkMode ? "dark" : "light",
        });
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(
            `Failed to load PostHog widgets bundle: ${String(loadError)}`,
          );
        }
      });

    return () => {
      cancelled = true;
      handleRef.current?.unmount();
      handleRef.current = null;
    };
  }, [cloudRegion, node.id]);

  useEffect(() => {
    handleRef.current?.update({ theme: isDarkMode ? "dark" : "light" });
  }, [isDarkMode]);

  return (
    <div className="flex min-h-24 w-full flex-col">
      {error ? (
        <div className="p-2 text-destructive text-sm">{error}</div>
      ) : null}
      <div ref={containerRef} className="w-full" />
    </div>
  );
}
