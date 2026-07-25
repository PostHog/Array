import type {
  Task,
  TaskRunStatus,
  UserBasic,
} from "@posthog/shared/domain-types";
import type { DashboardSummary } from "./dashboardSchemas";

/**
 * A channel's canvases and tasks as one sortable list. Deliberately data-only —
 * no icons, no click handlers — so the memo that builds it depends on data
 * alone and doesn't churn on every navigation.
 */
export interface ChannelItemModel {
  /** Stable identity across rebuilds; also the route-activeness key. */
  key: string;
  kind: "task" | "canvas";
  id: string;
  title: string;
  /** Epoch ms the item was last updated. */
  ts: number;
  pinned: boolean;
  /** Tasks only: the latest run's status. */
  rawStatus: TaskRunStatus | null;
  /** The author as a full user when we have one (tasks). */
  authorUser: UserBasic | null;
  /** The author as a bare display name when that's all we have (canvases). */
  authorName: string | null;
  /** Canvases only: which template drew it, so the caller can pick an icon. */
  templateId: string | null;
}

/** Who "me" is, for ownership checks. Either field may be unknown. */
export interface ChannelItemOwner {
  uuid: string | null;
  name: string | null;
}

/**
 * Whether an item belongs to `owner`. Items whose author we don't know count as
 * owned — a channel shouldn't hide your own items just because the author field
 * came back empty. Canvases only carry a display name, hence the name fallback.
 */
function isOwnedBy(
  item: Pick<ChannelItemModel, "authorUser" | "authorName">,
  owner: ChannelItemOwner,
): boolean {
  if (item.authorUser) return item.authorUser.uuid === owner.uuid;
  if (item.authorName && owner.name) return item.authorName === owner.name;
  return true;
}

export function buildChannelItems({
  dashboards,
  feedTasks,
  archivedTaskIds,
  pinnedTaskIds,
  ownedBy,
}: {
  dashboards: readonly DashboardSummary[];
  feedTasks: readonly Task[];
  archivedTaskIds: ReadonlySet<string>;
  pinnedTaskIds: ReadonlySet<string>;
  /**
   * Set only for the personal channel, and only once the current user is known
   * — otherwise the list is returned unfiltered rather than guessing.
   */
  ownedBy: ChannelItemOwner | null;
}): ChannelItemModel[] {
  const canvasItems: ChannelItemModel[] = dashboards.map((d) => ({
    key: `canvas:${d.id}`,
    kind: "canvas",
    id: d.id,
    title: d.name,
    ts: d.updatedAt,
    pinned: d.pinnedAt != null,
    rawStatus: null,
    authorUser: null,
    authorName: d.createdBy ?? null,
    templateId: d.templateId,
  }));

  const taskItems: ChannelItemModel[] = feedTasks.flatMap((task) =>
    archivedTaskIds.has(task.id)
      ? []
      : [
          {
            key: `task:${task.id}`,
            kind: "task" as const,
            id: task.id,
            title: task.title || "Untitled task",
            ts: Date.parse(task.updated_at) || 0,
            pinned: pinnedTaskIds.has(task.id),
            rawStatus: task.latest_run?.status ?? null,
            authorUser: task.created_by ?? null,
            authorName: null,
            templateId: null,
          },
        ],
  );

  const all = [...canvasItems, ...taskItems].sort((a, b) => b.ts - a.ts);
  return ownedBy ? all.filter((item) => isOwnedBy(item, ownedBy)) : all;
}

export type CreatedByFilter = "anyone" | "me" | "others";

export function filterChannelItems(
  items: readonly ChannelItemModel[],
  {
    query,
    createdBy,
    status,
    me,
  }: {
    query: string;
    createdBy: CreatedByFilter;
    status: TaskRunStatus | null;
    me: ChannelItemOwner;
  },
): ChannelItemModel[] {
  const normalizedQuery = query.trim().toLowerCase();
  return items.filter((item) => {
    if (
      normalizedQuery &&
      !item.title.toLowerCase().includes(normalizedQuery)
    ) {
      return false;
    }
    if (createdBy !== "anyone") {
      const mine = isOwnedBy(item, me);
      if (createdBy === "me" ? !mine : mine) return false;
    }
    if (status && item.rawStatus !== status) return false;
    return true;
  });
}
