import type { AuthService } from "@posthog/core/auth/auth";
import { AUTH_SERVICE } from "@posthog/core/auth/auth.module";
import { inject, injectable } from "inversify";
import type { ChannelTaskRecord } from "./channelTaskSchemas";

const TASK_TYPE = "task";
const MAX_PAGES = 50;

interface FsEntry {
  id: string;
  path: string;
  type?: string;
  ref?: string | null;
  created_at?: string;
}

/**
 * Tracks which tasks are filed to a channel by writing a `task` row to the
 * project's desktop_file_system under the channel folder. The task's "home"
 * row at Unfiled/Tasks/<title> is created by PostHog's FileSystemSyncMixin on
 * task save; these rows are additional filings that posthog preserves via the
 * remaining>0 check on delete.
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

  private async listUnderParent(parentPath: string): Promise<FsEntry[]> {
    const all: FsEntry[] = [];
    const query = `?parent=${encodeURIComponent(parentPath)}&type=${TASK_TYPE}`;
    let suffix = query;
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
    const channelPath = await this.channelPath(channelId);
    const entries = await this.listUnderParent(channelPath);
    return entries
      .filter((e) => !!e.ref)
      .map((e) => toRecord(e, channelId))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  async file(input: {
    channelId: string;
    taskId: string;
    taskTitle: string;
  }): Promise<ChannelTaskRecord> {
    const channelPath = await this.channelPath(input.channelId);
    const existing = (await this.list(input.channelId)).find(
      (r) => r.taskId === input.taskId,
    );
    if (existing) return existing;

    const res = await this.fsFetch("", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: `${channelPath}/${sanitizeSegment(input.taskTitle)}`,
        type: TASK_TYPE,
        ref: input.taskId,
        href: `/tasks/${input.taskId}`,
      }),
    });
    if (!res.ok) throw new Error(`Failed to file task (${res.status})`);
    return toRecord((await res.json()) as FsEntry, input.channelId);
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

function toRecord(entry: FsEntry, channelId: string): ChannelTaskRecord {
  return {
    id: entry.id,
    channelId,
    taskId: entry.ref ?? "",
    createdAt: toEpoch(entry.created_at),
  };
}

function sanitizeSegment(name: string): string {
  const cleaned = name.replace(/\//g, " ").replace(/\s+/g, " ").trim();
  return cleaned || "Untitled";
}

function toEpoch(iso?: string): number {
  if (!iso) return Date.now();
  const t = Date.parse(iso);
  return Number.isNaN(t) ? Date.now() : t;
}
