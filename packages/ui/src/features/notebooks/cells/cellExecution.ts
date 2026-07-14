/**
 * Framework-free helpers for runnable notebook cells: kernel execution-dict
 * normalization, traceback formatting, the DuckDB/HogQL kernel wrapper-code
 * builders (mirroring the PostHog webapp's notebookNodeLogic templates), and
 * HogQL placeholder detection.
 */

export interface CellExecutionMedia {
  mimeType: string;
  data: string;
}

/** Normalized execution outcome a cell renders and persists into node props. */
export interface CellExecution {
  status: "ok" | "error" | "running";
  stdout: string;
  stderr: string;
  /** `result["text/plain"]` (or html fallback) when the value isn't an image. */
  resultText: string | null;
  media: CellExecutionMedia[];
  executionCount: number | null;
  errorName: string | null;
  traceback: string[];
  startedAt: string | null;
  completedAt: string | null;
}

const IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/svg+xml",
  "image/gif",
  "image/webp",
];

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function extractResultText(result: unknown): string | null {
  const record = asRecord(result);
  if (!record) return null;
  const preferred = record["text/plain"] ?? record["text/html"];
  if (typeof preferred === "string") return preferred;
  // Pure-image results render as media, not as a text block.
  if (IMAGE_MIME_TYPES.some((mimeType) => record[mimeType])) return null;
  try {
    return JSON.stringify(record);
  } catch {
    return null;
  }
}

function extractMedia(value: unknown): CellExecutionMedia[] {
  if (!Array.isArray(value)) return [];
  const media: CellExecutionMedia[] = [];
  for (const item of value) {
    const record = asRecord(item);
    const mimeType = record?.mime_type ?? record?.mimeType;
    const data = record?.data;
    if (typeof mimeType === "string" && typeof data === "string") {
      media.push({ mimeType, data });
    }
  }
  return media;
}

/**
 * Normalize a kernel execution dict (from execute, the stream's `result`
 * frame, or a persisted node prop) into the shape cells render. Tolerates
 * both snake_case wire fields and a previously-persisted normalized value.
 */
export function normalizeKernelExecution(raw: unknown): CellExecution | null {
  const record = asRecord(raw);
  if (!record) return null;
  const status =
    record.status === "ok" || record.status === "running"
      ? record.status
      : "error";
  const resultText =
    typeof record.resultText === "string"
      ? record.resultText
      : extractResultText(record.result);
  return {
    status,
    stdout: asString(record.stdout),
    stderr: asString(record.stderr),
    resultText,
    media: extractMedia(record.media),
    executionCount:
      typeof record.execution_count === "number"
        ? record.execution_count
        : typeof record.executionCount === "number"
          ? record.executionCount
          : null,
    errorName:
      typeof record.error_name === "string"
        ? record.error_name
        : typeof record.errorName === "string"
          ? record.errorName
          : null,
    traceback: Array.isArray(record.traceback)
      ? record.traceback.filter((line): line is string => {
          return typeof line === "string";
        })
      : [],
    startedAt:
      typeof record.started_at === "string"
        ? record.started_at
        : typeof record.startedAt === "string"
          ? record.startedAt
          : null,
    completedAt:
      typeof record.completed_at === "string"
        ? record.completed_at
        : typeof record.completedAt === "string"
          ? record.completedAt
          : null,
  };
}

/** Build an error-shaped execution (e.g. a transport failure) for rendering. */
export function buildErrorExecution(message: string): CellExecution {
  return {
    status: "error",
    stdout: "",
    stderr: "",
    resultText: null,
    media: [],
    executionCount: null,
    errorName: "RuntimeError",
    traceback: [message],
    startedAt: null,
    completedAt: null,
  };
}

// Kernel tracebacks arrive with ANSI color escapes; we render plain text.
// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escapes are control characters by definition
const ANSI_ESCAPE_PATTERN = /\u001b\[[0-9;]*m/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE_PATTERN, "");
}

export function formatTraceback(traceback: string[]): string {
  return stripAnsi(traceback.join("\n"));
}

export function buildMediaSource(media: CellExecutionMedia): string | null {
  if (!media.mimeType || !media.data) return null;
  return `data:${media.mimeType};base64,${media.data}`;
}

// ---------------------------------------------------------------------------
// Kernel wrapper-code builders — copied from the webapp's notebookNodeLogic.
// `duck_execute`, `duck_save_table`, `hogql_execute` and
// `notebook_dataframe_page` are helpers pre-defined inside the kernel.
// ---------------------------------------------------------------------------

export const DEFAULT_DATAFRAME_PAGE_SIZE = 10;

export function resolveReturnVariable(
  returnVariable: unknown,
  fallback: string,
): string {
  const trimmed =
    typeof returnVariable === "string" ? returnVariable.trim() : "";
  return trimmed || fallback;
}

export function buildDuckSqlCode(
  code: string,
  returnVariable: string,
  pageSize: number = DEFAULT_DATAFRAME_PAGE_SIZE,
): string {
  const resolvedReturnVariable = resolveReturnVariable(
    returnVariable,
    "duck_df",
  );
  const sqlLiteral = JSON.stringify(code ?? "");
  const tableNameLiteral = JSON.stringify(resolvedReturnVariable);
  const previewPageSize = Math.max(1, pageSize || DEFAULT_DATAFRAME_PAGE_SIZE);
  return (
    `import json\n` +
    `${resolvedReturnVariable} = duck_execute(${sqlLiteral})\n` +
    `duck_save_table(${tableNameLiteral}, ${resolvedReturnVariable})\n` +
    `json.dumps(notebook_dataframe_page(${resolvedReturnVariable}, offset=0, limit=${previewPageSize}))`
  );
}

export function buildHogqlSqlAssignmentCode(
  code: string,
  returnVariable: string,
): string {
  const resolvedReturnVariable = resolveReturnVariable(
    returnVariable,
    "hogql_df",
  );
  const sqlLiteral = JSON.stringify(code ?? "");
  return `${resolvedReturnVariable} = hogql_execute(${sqlLiteral})`;
}

/**
 * True when the HogQL source contains `{placeholder}` syntax outside string
 * literals. Placeholder values live in the Python kernel, so plain
 * `hogql/execute` can't resolve them — cells show a hint in that case.
 */
export function hasHogqlPlaceholders(code: string): boolean {
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < code.length; index += 1) {
    const char = code[index];
    if (quote) {
      if (char === "\\") {
        index += 1; // skip the escaped character
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
    } else if (char === "{") {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Persisted SQL-cell result summaries (`hogqlExecution` / `duckExecution`
// props): enough to re-render the table after a reload without a kernel.
// ---------------------------------------------------------------------------

export interface SqlCellResultSummary {
  status: "ok" | "error";
  columns: string[];
  /** Preview rows (positional, matching `columns`). */
  rows: (string | number | boolean | null)[][];
  rowCount: number;
  error: string | null;
  completedAt: string | null;
}

const MAX_PERSISTED_PREVIEW_ROWS = 50;

function toPreviewCell(value: unknown): string | number | boolean | null {
  if (value == null) return null;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Coerce arbitrary result rows (arrays or records) into positional preview rows. */
export function toPositionalRows(
  rows: unknown[],
  columns: string[],
): (string | number | boolean | null)[][] {
  return rows.map((row) => {
    if (Array.isArray(row)) {
      return row.map(toPreviewCell);
    }
    const record = asRecord(row);
    if (record) {
      if (columns.length > 0) {
        return columns.map((column) => toPreviewCell(record[column]));
      }
      return Object.values(record).map(toPreviewCell);
    }
    return [toPreviewCell(row)];
  });
}

export function buildSqlResultSummary(input: {
  columns: string[];
  rows: unknown[];
  rowCount: number;
  error?: string | null;
}): SqlCellResultSummary {
  return {
    status: input.error ? "error" : "ok",
    columns: input.columns,
    rows: toPositionalRows(
      input.rows.slice(0, MAX_PERSISTED_PREVIEW_ROWS),
      input.columns,
    ),
    rowCount: input.rowCount,
    error: input.error ?? null,
    completedAt: new Date().toISOString(),
  };
}

/** Recover a persisted result summary from node props (tolerates junk). */
export function normalizeSqlResultSummary(
  raw: unknown,
): SqlCellResultSummary | null {
  const record = asRecord(raw);
  if (!record) return null;
  const columns = Array.isArray(record.columns)
    ? record.columns.map(String)
    : [];
  const rows = Array.isArray(record.rows)
    ? toPositionalRows(record.rows, columns)
    : [];
  const error = typeof record.error === "string" ? record.error : null;
  if (columns.length === 0 && rows.length === 0 && !error) return null;
  return {
    status: error ? "error" : "ok",
    columns,
    rows,
    rowCount:
      typeof record.rowCount === "number" ? record.rowCount : rows.length,
    error,
    completedAt:
      typeof record.completedAt === "string" ? record.completedAt : null,
  };
}

/**
 * The notebook kernel/* and hogql/execute backend actions declare no API
 * scopes, so PostHog rejects token-authenticated calls to them — as a 403
 * "This action does not support personal API key access" through the scope
 * layer, or as a 401 "Invalid access token" from the OAuth authentication
 * class. They are session-auth only until upstream adds required_scopes.
 * Detect those rejections so cells can explain the situation instead of
 * dumping the raw error. (Only used for kernel-backed calls, where a 401
 * cannot mean an expired session: the shared fetcher already retried with a
 * freshly refreshed token before throwing.)
 */
export const KERNEL_SESSION_ONLY_MESSAGE =
  "PostHog doesn't allow kernel access with desktop app authentication yet — kernel-backed cells currently run only in the PostHog web app.";

export function isSessionOnlyEndpointError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes("does not support personal API key access") ||
    (error.message.includes("[401]") &&
      error.message.includes("authentication_failed"))
  );
}
