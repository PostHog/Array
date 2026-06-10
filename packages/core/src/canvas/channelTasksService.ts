import type { AuthService } from "@posthog/core/auth/auth";
import { AUTH_SERVICE } from "@posthog/core/auth/auth.module";
import { inject, injectable } from "inversify";
import type {
  ChannelTaskFileMeta,
  ChannelTaskRecord,
} from "./channelTaskSchemas";

const CHANNEL_TASK_TYPE = "channel-task";
const MAX_PAGES = 50;

interface FsEntry {
  id: string;
  path: string;
  type?: string;
  meta?: ChannelTaskFileMeta | null;
  created_at?: string;
}

/**
 * Tracks which tasks have been filed to a channel by writing a `channel-task`
 * row to the project's desktop_file_system, nested under the channel folder.
 * The path's last segment is the taskId (stable); the title is resolved
 * separately by the renderer via useTasks.
 */
@injectable()
export class ChannelTasksService {
  constructor(
    @inject(AUTH_SERVICE)
    private readonly authService: AuthService,
  ) {}

  private async fsFetch(suffix: string, init?: RequestInit): Promise<Response> {
    const { apiHost } = await this.authService.getValidAccessToken();
    const projectId = this.authService.getState().currentProjectId;
    if (projectId == null) throw new Error("No PostHog project selected");
    const url = `${apiHost}/api/projects/${projectId}/desktop_file_system/${suffix}`;
    return this.authService.authenticatedFetch(fetch, url, init);
  }

  private async listAll(): Promise<FsEntry[]> {
    const all: FsEntry[] = [];
    let suffix = "";
    for (let i = 0; i < MAX_PAGES; i++) {
      const res = await this.fsFetch(suffix);
      if (!res.ok)
        throw new Error(`Failed to list channel tasks (${res.status})`);
      const page = (await res.json()) as {
        next: string | null;
        results: FsEntry[];
      };
      all.push(...page.results);
      if (!page.next) return all;
      suffix = new URL(page.next).search;
    }
    return all;
  }

  private async getEntry(id: string): Promise<FsEntry | null> {
    const res = await this.fsFetch(`${encodeURIComponent(id)}/`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Failed to load channel task (${res.status})`);
    return (await res.json()) as FsEntry;
  }

  async list(channelId: string): Promise<ChannelTaskRecord[]> {
    const entries = await this.listAll();
    return entries
      .filter(
        (e) => e.type === CHANNEL_TASK_TYPE && e.meta?.channelId === channelId,
      )
      .map((e) => toRecord(e))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  async file(input: {
    channelId: string;
    taskId: string;
  }): Promise<ChannelTaskRecord> {
    const channelPath = await this.channelPath(input.channelId);
    const existing = (await this.list(input.channelId)).find(
      (r) => r.taskId === input.taskId,
    );
    if (existing) return existing;

    const now = Date.now();
    const meta: ChannelTaskFileMeta = {
      channelId: input.channelId,
      taskId: input.taskId,
      createdAt: now,
    };
    const res = await this.fsFetch("", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: `${channelPath}/${sanitizeSegment(input.taskId)}`,
        type: CHANNEL_TASK_TYPE,
        meta,
      }),
    });
    if (!res.ok) throw new Error(`Failed to file task (${res.status})`);
    return toRecord((await res.json()) as FsEntry);
  }

  async unfile(id: string): Promise<void> {
    const res = await this.fsFetch(`${encodeURIComponent(id)}/`, {
      method: "DELETE",
    });
    if (!res.ok && res.status !== 404) {
      throw new Error(`Failed to unfile task (${res.status})`);
    }
  }

  private async channelPath(channelId: string): Promise<string> {
    const entry = await this.getEntry(channelId);
    if (!entry) throw new Error("Channel not found");
    return entry.path;
  }
}

function toRecord(entry: FsEntry): ChannelTaskRecord {
  const meta = entry.meta ?? {};
  const createdAt = meta.createdAt ?? toEpoch(entry.created_at);
  return {
    id: entry.id,
    channelId: meta.channelId ?? "",
    taskId: meta.taskId ?? lastSegment(entry.path),
    createdAt,
  };
}

function sanitizeSegment(name: string): string {
  const cleaned = name.replace(/\//g, " ").replace(/\s+/g, " ").trim();
  return cleaned || "untitled-task";
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
