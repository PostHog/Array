import type {
  NotebookSqlV2ResultEnvelope,
  PostHogAPIClient,
} from "@posthog/api-client/posthog-client";
import { useOptionalAuthenticatedClient } from "@posthog/ui/features/auth/authClient";
import { Database } from "lucide-react";
import type { JSX } from "react";
import { useEffect, useRef, useState } from "react";
import type {
  NotebookComponentRenderProps,
  NotebookPropValue,
} from "../markdown-notebook/types";
import { CellCodeEditor } from "./CellCodeEditor";
import {
  CellError,
  CellFrame,
  CellHint,
  ReturnVariableInput,
  RunCellButton,
} from "./cellBlocks";
import { resolveReturnVariable } from "./cellExecution";
import { useNotebookCellContext } from "./NotebookCellContext";
import { ResultsTable } from "./ResultsTable";
import { SqlV2RunTracker } from "./sqlV2RunTracker";

const SQL_V2_PAGE_LIMIT = 500;

/**
 * Runnable `<SQLV2/>` cell: submits the query as an async run
 * (`sql_v2/run`), persists the `runId`, polls until the run terminates, then
 * persists the result envelope and renders its first page (further pages come
 * from `sql_v2/runs/{id}/page`). A mount with a persisted `runId` and no
 * `result` resumes polling. When the server 404s the feature, the cell shows
 * a "not enabled" hint.
 */
export function SqlV2CellEmbed({
  node,
  updateProps,
}: NotebookComponentRenderProps): JSX.Element {
  const cellContext = useNotebookCellContext();
  const client = useOptionalAuthenticatedClient();
  const code = typeof node.props.code === "string" ? node.props.code : "";
  const title =
    typeof node.props.title === "string" && node.props.title.trim()
      ? node.props.title
      : "SQL (v2)";
  const returnVariable = resolveReturnVariable(
    node.props.returnVariable,
    "sql_df",
  );
  const persistedRunId =
    typeof node.props.runId === "string" && node.props.runId
      ? node.props.runId
      : null;
  const envelope = coerceEnvelope(node.props.result);

  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [disabled, setDisabled] = useState(false);

  // Latest client/updateProps for the tracker callbacks (created once).
  const clientRef = useRef<PostHogAPIClient | null>(client);
  clientRef.current = client;
  const shortIdRef = useRef(cellContext?.shortId ?? null);
  shortIdRef.current = cellContext?.shortId ?? null;
  const updatePropsRef = useRef(updateProps);
  updatePropsRef.current = updateProps;
  const codeRef = useRef(code);
  codeRef.current = code;

  const trackerRef = useRef<SqlV2RunTracker | null>(null);
  if (trackerRef.current === null) {
    trackerRef.current = new SqlV2RunTracker({
      poll: (runId) => {
        const activeClient = clientRef.current;
        const shortId = shortIdRef.current;
        if (!activeClient || !shortId) {
          return Promise.reject(new Error("Not connected to PostHog"));
        }
        return activeClient.notebookSqlV2RunStatus(shortId, runId);
      },
      onDone: (_runId, result) => {
        updatePropsRef.current({
          result: (result ?? null) as NotebookPropValue,
        });
        setRunning(false);
      },
      onFailed: (_runId, error) => {
        setRunError(error);
        setRunning(false);
      },
      onDisabled: () => {
        setDisabled(true);
        setRunning(false);
      },
    });
  }
  const tracker = trackerRef.current;

  // Recover after a reload/remount: a persisted runId with no result means the
  // run may still be in flight or already finished — poll to catch up.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only recovery
  useEffect(() => {
    if (persistedRunId && !envelope) {
      setRunning(true);
      tracker.start(persistedRunId);
    }
    return () => tracker.stop();
  }, []);

  const run = async (): Promise<void> => {
    const activeClient = clientRef.current;
    const shortId = shortIdRef.current;
    if (!activeClient || !shortId || running) return;
    if (!codeRef.current.trim()) {
      setRunError("Query is empty — type some SQL first.");
      return;
    }
    setRunError(null);
    setRunning(true);
    try {
      const response = await activeClient.notebookSqlV2Run(shortId, {
        node_id: node.id,
        code: codeRef.current,
        refs: {},
      });
      if (response.status === "disabled") {
        setDisabled(true);
        setRunning(false);
        return;
      }
      updatePropsRef.current({ runId: response.runId, result: null });
      tracker.start(response.runId);
    } catch (error) {
      setRunError(error instanceof Error ? error.message : "Failed to run");
      setRunning(false);
    }
  };

  const disabledReason = !cellContext
    ? "This cell can only run inside a notebook."
    : !client
      ? "Sign in to PostHog to run this cell."
      : null;

  const fetchPage =
    client && cellContext && persistedRunId
      ? async (offset: number, limit: number) => {
          const response = await client.notebookSqlV2RunPage(
            cellContext.shortId,
            persistedRunId,
            { offset, limit: Math.min(limit, SQL_V2_PAGE_LIMIT) },
          );
          if (response.status === "stale") {
            throw new Error(
              "This result was replaced by a newer run — re-run the query.",
            );
          }
          if (response.status === "busy") {
            throw new Error("The kernel is busy — try again in a moment.");
          }
          if (response.status === "disabled") {
            throw new Error("SQL v2 runs aren't enabled for this project.");
          }
          return { rows: response.page.rows };
        }
      : undefined;

  return (
    <CellFrame
      icon={<Database />}
      title={title}
      actions={
        <RunCellButton
          running={running}
          disabled={disabledReason !== null || disabled}
          disabledReason={disabledReason}
          onRun={() => void run()}
        />
      }
    >
      <CellCodeEditor
        value={code}
        language="sql"
        placeholder="Write SQL — Cmd/Ctrl+Enter runs the cell"
        onChange={(value) => updateProps({ code: value })}
        onRun={() => void run()}
      />
      {disabledReason ? <CellHint>{disabledReason}</CellHint> : null}
      {disabled ? (
        <CellHint>SQL v2 runs aren't enabled for this project.</CellHint>
      ) : null}
      {running ? <CellHint>Running… polling for the result.</CellHint> : null}
      {runError && !running ? <CellError>{runError}</CellError> : null}
      {!running && envelope ? (
        envelope.error ? (
          <CellError>{envelope.error}</CellError>
        ) : (
          <ResultsTable
            columns={envelope.columns ?? []}
            rows={envelope.first_page ?? []}
            rowCount={envelope.row_count ?? null}
            hasMore={envelope.has_more ?? false}
            fetchPage={fetchPage}
          />
        )
      ) : null}
      <ReturnVariableInput
        value={returnVariable}
        placeholder="sql_df"
        onCommit={(value) => updateProps({ returnVariable: value || "sql_df" })}
      />
    </CellFrame>
  );
}

function coerceEnvelope(value: unknown): NotebookSqlV2ResultEnvelope | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as NotebookSqlV2ResultEnvelope;
}
