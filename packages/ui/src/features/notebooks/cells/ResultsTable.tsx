// biome-ignore-all lint/suspicious/noArrayIndexKey: result rows and cells are purely positional
import { Button } from "@posthog/quill";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const PAGE_SIZES = [10, 50, 100];

export interface ResultsTableProps {
  columns: string[];
  /** First page of rows (offset 0), positional per `columns`. */
  rows: unknown[][];
  /** Total row count when known; null renders "n+ rows" when hasMore. */
  rowCount: number | null;
  hasMore?: boolean;
  /**
   * Server-side pager for rows beyond the initial page. Without it the table
   * paginates `rows` client-side.
   */
  fetchPage?: (offset: number, limit: number) => Promise<{ rows: unknown[][] }>;
}

/**
 * Columns+rows table with pagination for SQL/dataframe cell results, styled
 * to match the notebook Query embed's table.
 */
export function ResultsTable({
  columns,
  rows,
  rowCount,
  hasMore = false,
  fetchPage,
}: ResultsTableProps) {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
  const [remoteRows, setRemoteRows] = useState<unknown[][] | null>(null);
  const [loading, setLoading] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const fetchIdRef = useRef(0);

  // A new result resets paging (rows identity changes per run).
  // biome-ignore lint/correctness/useExhaustiveDependencies: rows identity is the reset signal
  useEffect(() => {
    setPage(0);
    setRemoteRows(null);
    setPageError(null);
  }, [rows]);

  const offset = page * pageSize;
  const initialCoversPage =
    !fetchPage || (offset + pageSize <= rows.length && page === 0) || !hasMore;

  useEffect(() => {
    if (initialCoversPage || !fetchPage) {
      setRemoteRows(null);
      return;
    }
    const fetchId = ++fetchIdRef.current;
    setLoading(true);
    setPageError(null);
    fetchPage(offset, pageSize)
      .then((result) => {
        if (fetchIdRef.current !== fetchId) return;
        setRemoteRows(result.rows);
      })
      .catch((error: unknown) => {
        if (fetchIdRef.current !== fetchId) return;
        setPageError(
          error instanceof Error ? error.message : "Failed to fetch page",
        );
        setRemoteRows(null);
      })
      .finally(() => {
        if (fetchIdRef.current === fetchId) setLoading(false);
      });
  }, [initialCoversPage, fetchPage, offset, pageSize]);

  const visibleRows = remoteRows ?? rows.slice(offset, offset + pageSize);
  const knownTotal = rowCount ?? (hasMore ? null : rows.length);
  const lastVisible = offset + visibleRows.length;
  // Without a server pager only the supplied rows are reachable, even when
  // the total row count is larger (persisted previews are capped).
  const reachableTotal = fetchPage ? knownTotal : rows.length;
  const canGoNext =
    reachableTotal !== null
      ? lastVisible < reachableTotal
      : visibleRows.length >= pageSize;

  return (
    <div className="flex flex-col gap-1">
      <div className="max-h-80 overflow-auto rounded border border-(--gray-4)">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 bg-(--gray-2)">
            <tr>
              {columns.map((column) => (
                <th
                  key={column}
                  className="border-(--gray-4) border-b px-2 py-1.5 text-left font-medium text-(--gray-11)"
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className={loading ? "opacity-50" : undefined}>
            {visibleRows.map((row, rowIndex) => (
              <tr key={rowIndex} className="odd:bg-(--gray-1)">
                {row.map((cell, cellIndex) => (
                  <td
                    key={cellIndex}
                    className="max-w-64 truncate border-(--gray-3) border-b px-2 py-1 text-(--gray-12)"
                  >
                    {formatResultCell(cell)}
                  </td>
                ))}
              </tr>
            ))}
            {visibleRows.length === 0 && !loading ? (
              <tr>
                <td
                  colSpan={Math.max(1, columns.length)}
                  className="px-2 py-2 text-(--gray-9)"
                >
                  No rows.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {pageError ? (
        <div className="text-(--red-11) text-xs">{pageError}</div>
      ) : null}
      <div className="flex items-center justify-between gap-2 text-(--gray-9) text-xs">
        <span>
          {visibleRows.length > 0
            ? `Rows ${offset + 1}–${lastVisible}`
            : "No rows"}
          {knownTotal !== null
            ? ` of ${knownTotal.toLocaleString()}`
            : hasMore
              ? " (more available)"
              : ""}
        </span>
        <div className="flex items-center gap-1">
          <select
            aria-label="Rows per page"
            className="rounded border border-(--gray-5) bg-transparent px-1 py-0.5 text-xs"
            value={pageSize}
            onChange={(event) => {
              setPageSize(Number(event.target.value));
              setPage(0);
            }}
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size} / page
              </option>
            ))}
          </select>
          <Button
            variant="outline"
            size="icon-xs"
            aria-label="Previous page"
            disabled={page === 0 || loading}
            onClick={() => setPage((current) => Math.max(0, current - 1))}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="outline"
            size="icon-xs"
            aria-label="Next page"
            disabled={!canGoNext || loading}
            onClick={() => setPage((current) => current + 1)}
          >
            <ChevronRight />
          </Button>
        </div>
      </div>
    </div>
  );
}

export function formatResultCell(cell: unknown): string {
  if (cell == null) return "";
  if (typeof cell === "object") {
    try {
      return JSON.stringify(cell);
    } catch {
      return String(cell);
    }
  }
  return String(cell);
}
