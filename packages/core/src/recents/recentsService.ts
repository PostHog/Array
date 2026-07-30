import {
  DESKTOP_FS_CLIENT,
  type DesktopFsClient,
  type FsEntryBase,
} from "@posthog/core/canvas/desktopFsClient";
import { inject, injectable } from "inversify";
import type { RecentEngagementInput, RecentItem } from "./schemas";

const RECENTS_LIMIT = 20;
const RECENTS_SCAN_LIMIT = 100;

interface RecentFsEntry extends FsEntryBase {
  last_viewed_at?: string | null;
  meta?: {
    channelId?: string;
    templateId?: string;
  } | null;
}

@injectable()
export class RecentsService {
  constructor(
    @inject(DESKTOP_FS_CLIENT)
    private readonly fs: DesktopFsClient,
  ) {}

  async list(): Promise<RecentItem[]> {
    const entries = await this.fs.listByQuery<RecentFsEntry>(
      `order_by=-last_viewed_at&limit=${RECENTS_SCAN_LIMIT}&not_type=folder`,
      "recent items",
    );
    return entries
      .flatMap((entry) => this.toRecentItem(entry))
      .sort((a, b) => b.engagedAt - a.engagedAt)
      .slice(0, RECENTS_LIMIT);
  }

  async record(input: RecentEngagementInput): Promise<void> {
    const type = input.kind === "canvas" ? "dashboard" : "task";
    if (input.kind === "canvas") {
      await this.ensureCanvasReference(input.id);
    }
    const response = await this.fs.fetch("log_view/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, ref: input.id }),
    });
    if (!response.ok) {
      throw new Error(
        `Failed to record recent engagement (${response.status})`,
      );
    }
  }

  private async ensureCanvasReference(id: string): Promise<void> {
    const entry = await this.fs.getEntry<RecentFsEntry>(id, "canvas");
    if (!entry) throw new Error("Canvas not found");
    if (entry.ref === id) return;
    const response = await this.fs.fetch(`${encodeURIComponent(id)}/`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ref: id }),
    });
    if (!response.ok) {
      throw new Error(`Failed to prepare canvas recents (${response.status})`);
    }
  }

  private toRecentItem(entry: RecentFsEntry): RecentItem[] {
    const engagedAt = entry.last_viewed_at
      ? Date.parse(entry.last_viewed_at)
      : 0;
    if (!entry.ref || engagedAt <= 0) return [];
    const title = entry.path.slice(entry.path.lastIndexOf("/") + 1);
    if (entry.type === "task") {
      return [{ kind: "task", id: entry.ref, title, engagedAt }];
    }
    if (entry.type === "dashboard" && entry.meta?.channelId) {
      return [
        {
          kind: "canvas",
          id: entry.ref,
          channelId: entry.meta.channelId,
          title,
          templateId: entry.meta.templateId ?? "freeform",
          engagedAt,
        },
      ];
    }
    return [];
  }
}
