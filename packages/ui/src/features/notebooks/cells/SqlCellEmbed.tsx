import type { PostHogAPIClient } from "@posthog/api-client/posthog-client";
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
  CellOutputBlock,
  ReturnVariableInput,
  RunCellButton,
} from "./cellBlocks";
import {
  buildDuckSqlCode,
  buildSqlResultSummary,
  formatTraceback,
  hasHogqlPlaceholders,
  isSessionOnlyEndpointError,
  KERNEL_SESSION_ONLY_MESSAGE,
  normalizeKernelExecution,
  normalizeSqlResultSummary,
  resolveReturnVariable,
  type SqlCellResultSummary,
  toPositionalRows,
} from "./cellExecution";
import { useNotebookCellContext } from "./NotebookCellContext";
import { ResultsTable } from "./ResultsTable";

type SqlDialect = "hogql" | "duck";

const DIALECT_CONFIG: Record<
  SqlDialect,
  {
    defaultTitle: string;
    executionProp: "hogqlExecution" | "duckExecution";
    returnVariableFallback: string;
  }
> = {
  hogql: {
    defaultTitle: "SQL (HogQL)",
    executionProp: "hogqlExecution",
    returnVariableFallback: "hogql_df",
  },
  duck: {
    defaultTitle: "SQL (DuckDB)",
    executionProp: "duckExecution",
    returnVariableFallback: "duck_df",
  },
};

const LIVE_PAGE_LIMIT = 500;

interface LiveTable {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  /** Duck results can page against the live kernel dataframe. */
  dataframeVariable: string | null;
}

export function HogqlSqlCellEmbed(
  props: NotebookComponentRenderProps,
): JSX.Element {
  return <SqlCellEmbed {...props} dialect="hogql" />;
}

export function DuckSqlCellEmbed(
  props: NotebookComponentRenderProps,
): JSX.Element {
  return <SqlCellEmbed {...props} dialect="duck" />;
}

/**
 * Runnable SQL cell shared by `<HogQLSQL/>` and `<DuckSQL/>`. HogQL runs
 * through the notebook's plain `hogql/execute` endpoint (no kernel); DuckDB
 * runs through the Python kernel with the webapp's `duck_execute` wrapper
 * code, then pages the resulting dataframe. A result summary persists into
 * `hogqlExecution`/`duckExecution` so tables survive reload.
 */
function SqlCellEmbed({
  node,
  updateProps,
  dialect,
}: NotebookComponentRenderProps & { dialect: SqlDialect }): JSX.Element {
  const config = DIALECT_CONFIG[dialect];
  const cellContext = useNotebookCellContext();
  const client = useOptionalAuthenticatedClient();
  const code = typeof node.props.code === "string" ? node.props.code : "";
  const title =
    typeof node.props.title === "string" && node.props.title.trim()
      ? node.props.title
      : config.defaultTitle;
  const returnVariable = resolveReturnVariable(
    node.props.returnVariable,
    config.returnVariableFallback,
  );

  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [liveTable, setLiveTable] = useState<LiveTable | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const codeRef = useRef(code);
  codeRef.current = code;
  const returnVariableRef = useRef(returnVariable);
  returnVariableRef.current = returnVariable;

  const persistSummary = (summary: SqlCellResultSummary): void => {
    updateProps({
      [config.executionProp]: summary as unknown as NotebookPropValue,
    });
  };

  const runHogql = async (
    activeClient: PostHogAPIClient,
    _shortId: string,
  ): Promise<void> => {
    // Deliberately the generic /query/ endpoint, not the notebook-scoped
    // hogql/execute: the latter declares no API scopes upstream, so PostHog
    // rejects all token auth ("does not support personal API key access") —
    // /query/ accepts the desktop token and returns the same columns/rows.
    const response = (await activeClient.runQueryNode({
      kind: "HogQLQuery",
      query: codeRef.current,
    })) as { columns?: unknown[]; results?: unknown[]; error?: string };
    if (!mountedRef.current) return;
    if (response.error) {
      setRunError(response.error);
      persistSummary(
        buildSqlResultSummary({
          columns: [],
          rows: [],
          rowCount: 0,
          error: response.error,
        }),
      );
      return;
    }
    const columns = (response.columns ?? []).map(String);
    const results = Array.isArray(response.results) ? response.results : [];
    setLiveTable({
      columns,
      rows: toPositionalRows(results, columns),
      rowCount: results.length,
      dataframeVariable: null,
    });
    persistSummary(
      buildSqlResultSummary({
        columns,
        rows: results,
        rowCount: results.length,
      }),
    );
  };

  const runDuck = async (
    activeClient: PostHogAPIClient,
    shortId: string,
  ): Promise<void> => {
    const variable = resolveReturnVariable(
      returnVariableRef.current,
      "duck_df",
    );
    const execution = await activeClient.notebookKernelExecute(shortId, {
      code: buildDuckSqlCode(codeRef.current, variable),
    });
    if (!mountedRef.current) return;
    const normalized = normalizeKernelExecution(execution);
    if (!normalized || normalized.status === "error") {
      const message = normalized?.errorName ?? "Execution failed";
      setRunError(message);
      setErrorDetail(
        normalized && normalized.traceback.length > 0
          ? formatTraceback(normalized.traceback)
          : normalized?.stderr || null,
      );
      persistSummary(
        buildSqlResultSummary({
          columns: [],
          rows: [],
          rowCount: 0,
          error: message,
        }),
      );
      return;
    }
    const dataframe = await activeClient.notebookKernelDataframe(shortId, {
      variableName: variable,
      offset: 0,
      limit: LIVE_PAGE_LIMIT,
    });
    if (!mountedRef.current) return;
    setLiveTable({
      columns: dataframe.columns,
      rows: toPositionalRows(dataframe.rows, dataframe.columns),
      rowCount: dataframe.row_count,
      dataframeVariable: variable,
    });
    persistSummary(
      buildSqlResultSummary({
        columns: dataframe.columns,
        rows: dataframe.rows,
        rowCount: dataframe.row_count,
      }),
    );
  };

  const run = async (): Promise<void> => {
    if (!client || !cellContext || running) return;
    setRunning(true);
    setRunError(null);
    setErrorDetail(null);
    setLiveTable(null);
    try {
      if (dialect === "hogql") {
        await runHogql(client, cellContext.shortId);
      } else {
        await runDuck(client, cellContext.shortId);
      }
    } catch (error) {
      if (mountedRef.current) {
        setRunError(
          isSessionOnlyEndpointError(error)
            ? KERNEL_SESSION_ONLY_MESSAGE
            : error instanceof Error
              ? error.message
              : "Query failed",
        );
      }
    } finally {
      if (mountedRef.current) setRunning(false);
    }
  };

  const persisted = normalizeSqlResultSummary(node.props[config.executionProp]);
  const disabledReason = !cellContext
    ? "This cell can only run inside a notebook."
    : !client
      ? "Sign in to PostHog to run this cell."
      : null;
  const showPlaceholderHint = dialect === "hogql" && hasHogqlPlaceholders(code);

  // Live duck results page against the kernel's dataframe variable.
  const fetchDataframePage =
    liveTable?.dataframeVariable && client && cellContext
      ? async (offset: number, limit: number) => {
          const page = await client.notebookKernelDataframe(
            cellContext.shortId,
            {
              variableName: liveTable.dataframeVariable as string,
              offset,
              limit,
            },
          );
          return { rows: toPositionalRows(page.rows, page.columns) };
        }
      : undefined;

  return (
    <CellFrame
      icon={<Database />}
      title={title}
      actions={
        <RunCellButton
          running={running}
          disabled={disabledReason !== null}
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
      {showPlaceholderHint ? (
        <CellHint>
          This query contains {"{placeholders}"}; they resolve from Python
          variables in the webapp and may fail here.
        </CellHint>
      ) : null}
      {running ? (
        <CellHint>
          {dialect === "duck"
            ? "Running… the kernel boots on first run, which can take up to a minute."
            : "Running query…"}
        </CellHint>
      ) : null}
      {runError && !running ? <CellError>{runError}</CellError> : null}
      {errorDetail && !running ? (
        <CellOutputBlock title="Error" tone="danger" text={errorDetail} />
      ) : null}
      {!running && !runError ? (
        liveTable ? (
          <ResultsTable
            columns={liveTable.columns}
            rows={liveTable.rows}
            rowCount={liveTable.rowCount}
            hasMore={liveTable.rows.length < liveTable.rowCount}
            fetchPage={fetchDataframePage}
          />
        ) : persisted && persisted.status === "ok" ? (
          <ResultsTable
            columns={persisted.columns}
            rows={persisted.rows}
            rowCount={persisted.rowCount}
            hasMore={persisted.rows.length < persisted.rowCount}
          />
        ) : persisted?.error ? (
          <CellError>{persisted.error}</CellError>
        ) : null
      ) : null}
      <ReturnVariableInput
        value={returnVariable}
        placeholder={config.returnVariableFallback}
        onCommit={(value) =>
          updateProps({
            returnVariable: value || config.returnVariableFallback,
          })
        }
      />
    </CellFrame>
  );
}
