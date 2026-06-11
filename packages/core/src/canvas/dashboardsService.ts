import { inject, injectable } from "inversify";
import type { DashboardQueryService } from "./dashboardQueryService";
import type {
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
import type { DashboardQuery } from "./querySchemas";

// Desktop file-system "type" tag for a dashboard entry. Channels are `folder`
// rows (depth 1); dashboards are these `dashboard` files nested beneath them.
const DASHBOARD_TYPE = "dashboard";

// Dashboard-specific shape on top of the shared FS row. Our payload rides in
// `meta` — see DashboardFileMeta for what that blob holds.
interface FsEntry extends FsEntryBase {
  meta?: DashboardFileMeta | null;
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
  constructor(
    @inject(DESKTOP_FS_CLIENT)
    private readonly fs: DesktopFsClient,
    @inject(DASHBOARD_QUERY_SERVICE)
    private readonly dashboardQuery: DashboardQueryService,
  ) {}

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
      .map(({ id, channelId: cid, name, updatedAt, spec }) => ({
        id,
        channelId: cid,
        name,
        updatedAt,
        spec,
      }));
  }

  async get(id: string): Promise<DashboardRecord | null> {
    const entry = await this.getEntry(id);
    return entry ? toRecord(entry) : null;
  }

  async create(input: {
    channelId: string;
    name: string;
    spec: Record<string, unknown> | null;
  }): Promise<DashboardRecord> {
    const channelPath = await this.channelPath(input.channelId);
    const now = Date.now();
    const meta: DashboardFileMeta = {
      spec: input.spec,
      channelId: input.channelId,
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
  }): Promise<{
    updated: number;
    failures: { elementKey: string; error: string }[];
  }> {
    const entry = await this.getEntry(input.id);
    const spec = entry?.meta?.spec;
    if (!entry || !spec) return { updated: 0, failures: [] };

    const queries = collectQueries(spec, input.elementKeys);
    if (queries.length === 0) return { updated: 0, failures: [] };

    const results = await this.dashboardQuery.run({ queries });

    let nextSpec = spec;
    let updated = 0;
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
    createdAt,
    updatedAt: meta.updatedAt ?? createdAt,
  };
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
type StoredQuery = { query?: unknown; column?: unknown };

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
        out.push({
          elementKey,
          propPath,
          query: stored.query,
          column: typeof stored.column === "string" ? stored.column : undefined,
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

// Immutably set spec.elements[elementKey].props[<propPath>]; no-op (same ref)
// when the element is absent.
function patchProp(
  spec: Record<string, unknown>,
  elementKey: string,
  propPath: string,
  value: string | number,
): Record<string, unknown> {
  const elements = spec.elements as
    | Record<string, { props?: Record<string, unknown> }>
    | undefined;
  const el = elements?.[elementKey];
  if (!elements || !el) return spec;
  const propName = propPath.replace(/^\//, "");
  return {
    ...spec,
    elements: {
      ...elements,
      [elementKey]: {
        ...el,
        props: { ...(el.props ?? {}), [propName]: value },
      },
    },
  };
}
