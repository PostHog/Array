import type { AuthService } from "@posthog/core/auth/auth";
import { AUTH_SERVICE } from "@posthog/core/auth/auth.module";
import { inject, injectable } from "inversify";
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
import type { FreeformVersion } from "./freeformSchemas";
import { fetchCurrentUser } from "./posthogApi";

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
 * name is the last path segment — i.e. the canvas title. The freeform React
 * source lives in the row's `meta.code`. This keeps dashboards (and their names)
 * in sync with the backend, the same surface that owns channel names.
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
    @inject(AUTH_SERVICE)
    private readonly authService: AuthService,
  ) {}

  // The signed-in user's display name (or email), for stamping `created by` onto
  // canvases. Cached after the first lookup; never throws (returns undefined).
  private async currentUserLabel(): Promise<string | undefined> {
    if (this.userLabel !== undefined) return this.userLabel ?? undefined;
    const user = await fetchCurrentUser(this.authService);
    this.userLabel = user?.label ?? null;
    return this.userLabel ?? undefined;
  }

  private getEntry(id: string): Promise<FsEntry | null> {
    return this.fs.getEntry<FsEntry>(id, "dashboard");
  }

  async list(channelId: string): Promise<DashboardSummary[]> {
    // Fetch only this channel's dashboards via a server-side filter
    // (`parent=<channelPath>&type=dashboard`) rather than walking the whole
    // project file system and filtering client-side. Dashboards are created as
    // direct children of the channel folder, so the parent filter matches them.
    const channelPath = await this.channelPath(channelId);
    const entries = await this.fs.listByQuery<FsEntry>(
      `parent=${encodeURIComponent(channelPath)}&type=${DASHBOARD_TYPE}`,
      "dashboards",
    );
    return entries
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
          code,
        }) => ({
          id,
          channelId: cid,
          name,
          templateId,
          createdBy,
          updatedAt,
          code,
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
    templateId?: string;
  }): Promise<DashboardRecord> {
    const channelPath = await this.channelPath(input.channelId);
    const now = Date.now();
    const templateId = input.templateId ?? "freeform";
    const meta: DashboardFileMeta = {
      channelId: input.channelId,
      templateId,
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

  // Persist a freeform canvas's source + edit history.
  async saveFreeform(input: {
    id: string;
    name?: string;
    code: string;
    versions: FreeformVersion[];
    currentVersionId?: string;
    context?: string;
  }): Promise<DashboardRecord> {
    const entry = await this.getEntry(input.id);
    const now = Date.now();
    const prevMeta = entry?.meta ?? {};
    const meta: DashboardFileMeta = {
      ...prevMeta,
      code: input.code,
      versions: input.versions,
      currentVersionId: input.currentVersionId,
      context: input.context,
      updatedAt: now,
      createdAt: prevMeta.createdAt ?? toEpoch(entry?.created_at),
    };

    const body: Record<string, unknown> = { meta };
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
    if (!res.ok) throw new Error(`Failed to save canvas (${res.status})`);
    return toRecord((await res.json()) as FsEntry);
  }

  // Record (or clear, when taskId is null) the task currently generating this
  // canvas. Merges into meta like the other writers so it never clobbers
  // code/versions; the agent's MCP publish likewise merges, so the two coexist.
  async setGenerationTask(input: {
    id: string;
    taskId: string | null;
  }): Promise<DashboardRecord> {
    const entry = await this.getEntry(input.id);
    const prevMeta = entry?.meta ?? {};
    const meta: DashboardFileMeta = {
      ...prevMeta,
      generationTaskId: input.taskId,
    };
    const res = await this.fs.fetch(`${encodeURIComponent(input.id)}/`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meta }),
    });
    if (!res.ok) {
      throw new Error(`Failed to set generation task (${res.status})`);
    }
    return toRecord((await res.json()) as FsEntry);
  }

  // Rename a canvas by rewriting the last path segment (the title). Touches only
  // the path, leaving meta (code/versions/etc.) intact — used to auto-name a
  // freshly-created canvas from its generation prompt.
  async rename(input: { id: string; name: string }): Promise<DashboardRecord> {
    const entry = await this.getEntry(input.id);
    if (!entry) throw new Error("Dashboard not found");
    const parent = parentPath(entry.path);
    const next = sanitizeSegment(input.name);
    const newPath = parent ? `${parent}/${next}` : next;
    if (newPath === entry.path) return toRecord(entry);
    const res = await this.fs.fetch(`${encodeURIComponent(input.id)}/`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: newPath }),
    });
    if (!res.ok) throw new Error(`Failed to rename canvas (${res.status})`);
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

  // Resolve a channel's folder path from its file-system id so child dashboards
  // can be created beneath it (paths are name-based, ids are not).
  private async channelPath(channelId: string): Promise<string> {
    const entry = await this.getEntry(channelId);
    if (!entry) throw new Error("Channel not found");
    return entry.path;
  }
}

// Build the renderer-facing record from a file-system row. The name is the last
// path segment (the canvas title); code + timestamps ride in `meta`.
function toRecord(entry: FsEntry): DashboardRecord {
  const meta = entry.meta ?? {};
  const createdAt = meta.createdAt ?? toEpoch(entry.created_at);
  return {
    id: entry.id,
    channelId: meta.channelId ?? "",
    name: lastSegment(entry.path),
    templateId: meta.templateId ?? "freeform",
    code: meta.code,
    versions: meta.versions,
    currentVersionId: meta.currentVersionId,
    context: meta.context,
    generationTaskId: meta.generationTaskId,
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
