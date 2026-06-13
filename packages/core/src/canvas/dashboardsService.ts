import type { AuthService } from "@posthog/core/auth/auth";
import { AUTH_SERVICE } from "@posthog/core/auth/auth.module";
import { inject, injectable } from "inversify";
import type { DashboardQueryService } from "./dashboardQueryService";
import type {
  DashboardDateRange,
  DashboardFileMeta,
  DashboardRecord,
  DashboardSummary,
} from "./dashboardSchemas";
import {
  DESKTOP_FS_CLIENT,
  type DesktopFsClient,
  type FsEntryBase,
} from "./desktopFsClient";
import { DASHBOARD_QUERY_SERVICE } from "./identifiers";
import type { DashboardQuery, DashboardQueryShape } from "./querySchemas";

// Desktop file-system "type" tag for a dashboard entry. Channels are `folder`
// rows (depth 1); dashboards are these `dashboard` files nested beneath them.
const DASHBOARD_TYPE = "dashboard";

// Dashboard-specific shape on top of the shared FS row. Our payload rides in
// `meta` — see DashboardFileMeta for what that blob holds.
interface FsEntry extends FsEntryBase {
  meta?: DashboardFileMeta | null;
  // The backend's creator user (standard PostHog UserBasic shape). Absent on
  // rows the API returns without an expanded creator.
  created_by?: {
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
  } | null;
}

/**
 * Dashboards backed by the PostHog desktop file system (not local files), so a
 * dashboard is a `dashboard`-typed row nested under its channel folder and its
 * name is the last path segment — i.e. the canvas h1. The json-render spec lives
 * in the row's `meta.spec`. This keeps dashboards (and their names) in sync with
 * the backend, the same surface that owns channel names.
 */
@injectable()
export class DashboardsService {
  // The current user's display label, fetched once and reused (the creator is
  // the same user for the app's lifetime). `undefined` = not fetched yet;
  // `null` = fetched but unavailable (don't refetch on every create).
  private userLabel: string | null | undefined;

  constructor(
    @inject(DESKTOP_FS_CLIENT)
    private readonly fs: DesktopFsClient,
    @inject(DASHBOARD_QUERY_SERVICE)
    private readonly dashboardQuery: DashboardQueryService,
    @inject(AUTH_SERVICE)
    private readonly authService: AuthService,
  ) {}

  // The signed-in user's display name (or email), for stamping `created by` onto
  // canvases. Cached after the first lookup; never throws (returns undefined).
  private async currentUserLabel(): Promise<string | undefined> {
    if (this.userLabel !== undefined) return this.userLabel ?? undefined;
    try {
      const { apiHost } = await this.authService.getValidAccessToken();
      const res = await this.authService.authenticatedFetch(
        fetch,
        `${apiHost}/api/users/@me/`,
      );
      if (!res.ok) {
        this.userLabel = null;
        return undefined;
      }
      const data = (await res.json()) as {
        first_name?: string | null;
        last_name?: string | null;
        email?: string | null;
      };
      const name = [data.first_name, data.last_name]
        .filter(Boolean)
        .join(" ")
        .trim();
      this.userLabel = name || data.email || null;
      return this.userLabel ?? undefined;
    } catch {
      this.userLabel = null;
      return undefined;
    }
  }

  private listAll(): Promise<FsEntry[]> {
    return this.fs.listAll<FsEntry>("dashboards");
  }

  private getEntry(id: string): Promise<FsEntry | null> {
    return this.fs.getEntry<FsEntry>(id, "dashboard");
  }

  async list(channelId: string): Promise<DashboardSummary[]> {
    const entries = await this.listAll();
    return entries
      .filter(
        (e) => e.type === DASHBOARD_TYPE && e.meta?.channelId === channelId,
      )
      .map((e) => toRecord(e))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(
        ({
          id,
          channelId: cid,
          name,
          templateId,
          createdBy,
          updatedAt,
          spec,
        }) => ({
          id,
          channelId: cid,
          name,
          templateId,
          createdBy,
          updatedAt,
          spec,
        }),
      );
  }

  async get(id: string): Promise<DashboardRecord | null> {
    const entry = await this.getEntry(id);
    return entry ? toRecord(entry) : null;
  }

  async create(input: {
    channelId: string;
    name: string;
    spec: Record<string, unknown> | null;
    templateId?: string;
  }): Promise<DashboardRecord> {
    const channelPath = await this.channelPath(input.channelId);
    const now = Date.now();
    const meta: DashboardFileMeta = {
      spec: input.spec,
      channelId: input.channelId,
      templateId: input.templateId ?? "dashboard",
      createdBy: await this.currentUserLabel(),
      createdAt: now,
      updatedAt: now,
    };
    const res = await this.fs.fetch("", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: `${channelPath}/${sanitizeSegment(input.name)}`,
        type: DASHBOARD_TYPE,
        meta,
      }),
    });
    if (!res.ok) throw new Error(`Failed to create dashboard (${res.status})`);
    return toRecord((await res.json()) as FsEntry);
  }

  async update(input: {
    id: string;
    name?: string;
    spec: Record<string, unknown> | null;
  }): Promise<DashboardRecord> {
    const entry = await this.getEntry(input.id);
    const now = Date.now();
    const prevMeta = entry?.meta ?? {};
    const meta: DashboardFileMeta = {
      ...prevMeta,
      spec: input.spec,
      updatedAt: now,
      createdAt: prevMeta.createdAt ?? toEpoch(entry?.created_at),
    };

    const body: Record<string, unknown> = { meta };
    // A new name renames the file: keep it under the same parent folder so the
    // canvas h1 stays the dashboard's name on the backend too.
    if (input.name && entry) {
      const parent = parentPath(entry.path);
      const next = sanitizeSegment(input.name);
      const newPath = parent ? `${parent}/${next}` : next;
      if (newPath !== entry.path) body.path = newPath;
    }

    const res = await this.fs.fetch(`${encodeURIComponent(input.id)}/`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to save dashboard (${res.status})`);
    return toRecord((await res.json()) as FsEntry);
  }

  async delete(id: string): Promise<void> {
    const res = await this.fs.fetch(`${encodeURIComponent(id)}/`, {
      method: "DELETE",
    });
    // Already gone is a successful delete; surface anything else.
    if (!res.ok && res.status !== 404) {
      throw new Error(`Failed to delete dashboard (${res.status})`);
    }
  }

  // Re-run the HogQL queries stored at spec.state.queries and write the fresh
  // values back into the spec props. `elementKeys` (a card's element) limits the
  // refresh to that card's subtree. Failures keep their prior literal.
  async refresh(input: {
    id: string;
    elementKeys?: string[];
    touchUpdatedAt?: boolean;
    dateRange?: DashboardDateRange;
    persistRange?: boolean;
  }): Promise<{
    updated: number;
    failures: { elementKey: string; error: string }[];
  }> {
    const entry = await this.getEntry(input.id);
    const spec = entry?.meta?.spec;
    if (!entry || !spec) return { updated: 0, failures: [] };

    // The window to query: the caller's (a rolled or freshly-picked range) wins;
    // otherwise reuse what's stored on the spec.
    const range = input.dateRange ?? storedRange(spec);

    const queries = collectQueries(spec, input.elementKeys).map((q) => ({
      ...q,
      query: substituteDateTokens(q.query, range),
    }));

    const results =
      queries.length > 0 ? await this.dashboardQuery.run({ queries }) : [];

    // Only an explicit user pick (persistRange) rewrites the stored range — an
    // auto-rolling refresh just substitutes, so polling doesn't churn the file.
    // Persisting is itself a change (even if no value moved) so the board reopens
    // on the picked window and the picker reflects it.
    let nextSpec =
      input.dateRange && input.persistRange
        ? withStoredRange(spec, input.dateRange)
        : spec;
    let updated =
      input.dateRange && input.persistRange && nextSpec !== spec ? 1 : 0;
    const failures: { elementKey: string; error: string }[] = [];
    for (const r of results) {
      if (r.ok) {
        const patched = patchProp(nextSpec, r.elementKey, r.propPath, r.value);
        if (patched !== nextSpec) {
          nextSpec = patched;
          updated++;
        }
      } else {
        failures.push({ elementKey: r.elementKey, error: r.error });
      }
    }

    // Only write when a value actually changed (the `updated > 0` guard already
    // skips no-op polls). This is still last-write-wins on `meta.spec`: a polling
    // refresh and a concurrent edit on another client can clobber each other. The
    // desktop FS rows carry no `base_version` for `meta` (unlike folder
    // instructions), so true optimistic concurrency is deferred — for now refresh
    // is UI-gated to view mode, which avoids self-clobber within one client.
    if (updated > 0) {
      const prevMeta = entry.meta ?? {};
      const meta: DashboardFileMeta = {
        ...prevMeta,
        spec: nextSpec,
        updatedAt:
          input.touchUpdatedAt === false
            ? (prevMeta.updatedAt ?? toEpoch(entry.created_at))
            : Date.now(),
      };
      await this.fs.fetch(`${encodeURIComponent(input.id)}/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meta }),
      });
    }
    return { updated, failures };
  }

  // Resolve a channel's folder path from its file-system id so child dashboards
  // can be created beneath it (paths are name-based, ids are not).
  private async channelPath(channelId: string): Promise<string> {
    const entry = await this.getEntry(channelId);
    if (!entry) throw new Error("Channel not found");
    return entry.path;
  }
}

// Build the renderer-facing record from a file-system row. The name is the last
// path segment (the canvas h1); spec + timestamps ride in `meta`.
function toRecord(entry: FsEntry): DashboardRecord {
  const meta = entry.meta ?? {};
  const createdAt = meta.createdAt ?? toEpoch(entry.created_at);
  return {
    id: entry.id,
    channelId: meta.channelId ?? "",
    name: lastSegment(entry.path),
    spec: meta.spec ?? null,
    templateId: meta.templateId ?? "dashboard",
    // Prefer our stamped meta; fall back to the FS row's creator if present.
    createdBy: meta.createdBy ?? creatorName(entry.created_by),
    createdAt,
    updatedAt: meta.updatedAt ?? createdAt,
  };
}

// Human-readable creator from the backend's `created_by` user: full name when
// present, else email, else undefined (we don't render an id).
function creatorName(createdBy?: FsEntry["created_by"]): string | undefined {
  if (!createdBy) return undefined;
  const name = [createdBy.first_name, createdBy.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();
  return name || createdBy.email || undefined;
}

// Path segments are "/"-separated on the backend, so a name can't contain one.
function sanitizeSegment(name: string): string {
  const cleaned = name.replace(/\//g, " ").replace(/\s+/g, " ").trim();
  return cleaned || "Untitled dashboard";
}

function parentPath(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

function lastSegment(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? path : path.slice(i + 1);
}

function toEpoch(iso?: string): number {
  if (!iso) return Date.now();
  const t = Date.parse(iso);
  return Number.isNaN(t) ? Date.now() : t;
}

type SpecElements = Record<string, { children?: string[]; props?: unknown }>;
type StoredQuery = { query?: unknown; column?: unknown; shape?: unknown };

const QUERY_SHAPES = new Set<DashboardQueryShape>([
  "scalar",
  "column",
  "labels",
  "matrix",
  "pairs",
  "retention",
]);

// The spec's stored time window, if any (written under state.dateRange).
function storedRange(
  spec: Record<string, unknown>,
): DashboardDateRange | undefined {
  const state = spec.state as Record<string, unknown> | undefined;
  const r = state?.dateRange as Record<string, unknown> | undefined;
  if (r && typeof r.from === "number" && typeof r.to === "number") {
    return {
      name: typeof r.name === "string" ? r.name : "Custom",
      from: r.from,
      to: r.to,
    };
  }
  return undefined;
}

// Immutably set spec.state.dateRange (creating state if absent). No-op (same
// ref) when the range already matches.
function withStoredRange(
  spec: Record<string, unknown>,
  range: DashboardDateRange,
): Record<string, unknown> {
  const prev = storedRange(spec);
  if (
    prev &&
    prev.name === range.name &&
    prev.from === range.from &&
    prev.to === range.to
  ) {
    return spec;
  }
  const state = (spec.state as Record<string, unknown> | undefined) ?? {};
  return { ...spec, state: { ...state, dateRange: range } };
}

// Replace the window placeholders in a query with HogQL datetime literals for the
// active window. Besides `{date_from}`/`{date_to}`, the `_prev` pair spans the
// equal-length window immediately before it (for prior-period comparison series)
// so the comparison tracks the window length instead of a hardcoded interval. No
// range or no tokens → the query is returned as-is.
function substituteDateTokens(
  query: string,
  range: DashboardDateRange | undefined,
): string {
  if (!range || !/\{date_(from|to)(_prev)?\}/.test(query)) return query;
  const length = range.to - range.from;
  return query
    .replaceAll("{date_from_prev}", toHogQLDateTime(range.from - length))
    .replaceAll("{date_to_prev}", toHogQLDateTime(range.from))
    .replaceAll("{date_from}", toHogQLDateTime(range.from))
    .replaceAll("{date_to}", toHogQLDateTime(range.to));
}

// An epoch-ms instant as a `toDateTime(<unix seconds>)` literal — the integer
// form is an unambiguous UTC instant, unlike a bare 'YYYY-MM-DD HH:MM:SS' string
// (which HogQL would parse in the PROJECT timezone, shifting the window by the
// project's UTC offset). Drops straight into a comparison: `timestamp >= {date_from}`.
function toHogQLDateTime(epochMs: number): string {
  return `toDateTime(${Math.floor(epochMs / 1000)})`;
}

// Collect refreshable queries from spec.state.queries, optionally limited to the
// subtree(s) of `elementKeys` and skipping queries whose element no longer exists.
function collectQueries(
  spec: Record<string, unknown>,
  elementKeys?: string[],
): DashboardQuery[] {
  const state = spec.state as Record<string, unknown> | undefined;
  const queriesMap = state?.queries as
    | Record<string, Record<string, StoredQuery>>
    | undefined;
  if (!queriesMap) return [];

  const elements = spec.elements as SpecElements | undefined;
  const allowed =
    elementKeys && elements ? descendantKeys(elements, elementKeys) : null;

  const out: DashboardQuery[] = [];
  for (const [elementKey, props] of Object.entries(queriesMap)) {
    if (allowed && !allowed.has(elementKey)) continue;
    if (elements && !elements[elementKey]) continue; // stale key
    for (const [propPath, stored] of Object.entries(props)) {
      if (stored && typeof stored.query === "string") {
        const shape =
          typeof stored.shape === "string" &&
          QUERY_SHAPES.has(stored.shape as DashboardQueryShape)
            ? (stored.shape as DashboardQueryShape)
            : "scalar";
        out.push({
          elementKey,
          propPath,
          query: stored.query,
          column: typeof stored.column === "string" ? stored.column : undefined,
          shape,
        });
      }
    }
  }
  return out;
}

// Keys reachable from any of `roots` via `children` (inclusive of the roots).
function descendantKeys(elements: SpecElements, roots: string[]): Set<string> {
  const seen = new Set<string>();
  const stack = [...roots];
  while (stack.length > 0) {
    const key = stack.pop();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const children = elements[key]?.children;
    if (children) stack.push(...children);
  }
  return seen;
}

// Immutably set a value at `propPath` (a JSON pointer, e.g. "/value" or
// "/series/0/data") within spec.elements[elementKey].props; no-op (same ref)
// when the element is absent or the value is unchanged. Nested paths let one
// chart's series fill from separate queries (`/series/0/data`, `/series/1/data`).
function patchProp(
  spec: Record<string, unknown>,
  elementKey: string,
  propPath: string,
  value: unknown,
): Record<string, unknown> {
  const elements = spec.elements as
    | Record<string, { props?: Record<string, unknown> }>
    | undefined;
  const el = elements?.[elementKey];
  if (!elements || !el) return spec;
  const segments = propPath.split("/").filter(Boolean);
  if (segments.length === 0) return spec;
  // Skip when the value is unchanged (same ref) so a poll on stable data doesn't
  // rewrite meta.spec every tick — `refresh` only persists when something moved.
  if (deepEqual(getAtPointer(el.props ?? {}, segments), value)) return spec;
  const nextProps = setAtPointer(el.props ?? {}, segments, value);
  return {
    ...spec,
    elements: {
      ...elements,
      [elementKey]: { ...el, props: nextProps },
    },
  };
}

// Read the value at a pointer path, or undefined if any segment is missing.
function getAtPointer(container: unknown, segments: string[]): unknown {
  let cur: unknown = container;
  for (const seg of segments) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

// Structural equality for the scalar/array/plain-object values refresh writes.
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (typeof a !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    return a.every((x, i) => deepEqual(x, b[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao);
  const bk = Object.keys(bo);
  return ak.length === bk.length && ak.every((k) => deepEqual(ao[k], bo[k]));
}

// Immutable set at a pointer path, cloning containers along the way. A numeric
// segment indexes (and grows, if needed) an array; otherwise it's an object key.
function setAtPointer(
  container: unknown,
  segments: string[],
  value: unknown,
): Record<string, unknown> {
  const [head, ...rest] = segments;
  const index = /^\d+$/.test(head) ? Number(head) : null;

  if (index !== null) {
    const arr = Array.isArray(container) ? [...container] : [];
    arr[index] =
      rest.length === 0 ? value : setAtPointer(arr[index], rest, value);
    return arr as unknown as Record<string, unknown>;
  }

  const obj =
    container && typeof container === "object" && !Array.isArray(container)
      ? { ...(container as Record<string, unknown>) }
      : {};
  obj[head] = rest.length === 0 ? value : setAtPointer(obj[head], rest, value);
  return obj;
}
