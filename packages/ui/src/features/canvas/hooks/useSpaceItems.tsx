import { FileTextIcon } from "@phosphor-icons/react";
import type { DashboardSummary } from "@posthog/core/canvas/dashboardSchemas";
import { useArchivedTaskIds } from "@posthog/ui/features/archive/useArchivedTaskIds";
import { useArchiveTask } from "@posthog/ui/features/archive/useArchiveTask";
import { useOptionalAuthenticatedClient } from "@posthog/ui/features/auth/authClient";
import { useCurrentUser } from "@posthog/ui/features/auth/useCurrentUser";
import { iconForTemplate } from "@posthog/ui/features/canvas/components/canvasTemplateIcon";
import {
  humanizeStatus,
  type SpaceItem,
  statusVariantFor,
} from "@posthog/ui/features/canvas/components/SpaceItemRow";
import { useChannelFeed } from "@posthog/ui/features/canvas/hooks/useChannelFeed";
import {
  useDashboardMutations,
  useDashboards,
} from "@posthog/ui/features/canvas/hooks/useDashboards";
import {
  PERSONAL_CHANNEL_NAME,
  useBackendChannel,
} from "@posthog/ui/features/canvas/hooks/useTaskChannels";
import { userDisplayName } from "@posthog/ui/features/canvas/utils/userDisplay";
import { usePinnedTasks } from "@posthog/ui/features/sidebar/usePinnedTasks";
import { toast } from "@posthog/ui/primitives/toast";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useMemo } from "react";

/**
 * A space's canvases + task feed as merged, newest-first items. The personal
 * "#me" space is filtered to the current user. Also returns the user's identity
 * for the recent-list filters.
 */
export function useSpaceItems(
  channelId: string,
  channelName: string,
): { items: SpaceItem[]; meUuid: string | null; meName: string | null } {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const { dashboards } = useDashboards(channelId);
  const { channel: backendChannel } = useBackendChannel(channelName);
  const { tasks: feedTasks } = useChannelFeed(backendChannel?.id);
  const archivedTaskIds = useArchivedTaskIds();
  const { pinnedTaskIds, togglePin } = usePinnedTasks();
  const { archiveTask } = useArchiveTask({ navigateSpace: "website" });
  const { setPinned: setCanvasPinned } = useDashboardMutations();
  const client = useOptionalAuthenticatedClient();
  const { data: currentUser } = useCurrentUser({ client });

  const base = `/website/${channelId}`;
  const isPersonal = channelName === PERSONAL_CHANNEL_NAME;
  const meUuid = currentUser?.uuid ?? null;
  const meName = currentUser ? userDisplayName(currentUser) : null;

  const items = useMemo<SpaceItem[]>(() => {
    const canvasItems: SpaceItem[] = dashboards.map((d: DashboardSummary) => ({
      key: `canvas:${d.id}`,
      kind: "canvas",
      title: d.name,
      ts: d.updatedAt,
      pinned: d.pinnedAt != null,
      icon: iconForTemplate(d.templateId, {
        size: 15,
        className: "text-violet-9",
      }),
      status: null,
      rawStatus: null,
      statusVariant: "default" as const,
      authorUser: null,
      authorName: d.createdBy ?? null,
      isActive: pathname === `${base}/dashboards/${d.id}`,
      onClick: () =>
        void navigate({
          to: "/website/$channelId/dashboards/$dashboardId",
          params: { channelId, dashboardId: d.id },
        }),
      onTogglePin: () => {
        setCanvasPinned(d.id, d.pinnedAt == null).catch(() => {
          toast.error("Couldn't update pin");
        });
      },
    }));

    const taskItems: SpaceItem[] = feedTasks.flatMap((task) => {
      if (archivedTaskIds.has(task.id)) return [];
      return [
        {
          key: `task:${task.id}`,
          kind: "task" as const,
          title: task.title || "Untitled task",
          ts: Date.parse(task.updated_at) || 0,
          pinned: pinnedTaskIds.has(task.id),
          icon: <FileTextIcon size={15} className="text-blue-9" />,
          status: humanizeStatus(task.latest_run?.status),
          rawStatus: task.latest_run?.status ?? null,
          statusVariant: statusVariantFor(task.latest_run?.status),
          authorUser: task.created_by ?? null,
          authorName: task.created_by ? userDisplayName(task.created_by) : null,
          isActive: pathname === `${base}/tasks/${task.id}`,
          onClick: () =>
            void navigate({
              to: "/website/$channelId/tasks/$taskId",
              params: { channelId, taskId: task.id },
            }),
          onTogglePin: () => {
            togglePin(task.id).catch(() => {
              toast.error("Couldn't update pin");
            });
          },
          onArchive: () => {
            void archiveTask({ taskId: task.id });
          },
        },
      ];
    });

    const all = [...canvasItems, ...taskItems].sort((a, b) => b.ts - a.ts);

    // The personal space is yours: drop items with a known author that isn't
    // you (unknown authors stay; wait until the current user has loaded).
    if (!isPersonal || (!meUuid && !meName)) return all;
    return all.filter((item) => {
      if (item.authorUser) return item.authorUser.uuid === meUuid;
      if (item.authorName && meName) return item.authorName === meName;
      return true;
    });
  }, [
    dashboards,
    feedTasks,
    archivedTaskIds,
    pinnedTaskIds,
    pathname,
    base,
    channelId,
    navigate,
    togglePin,
    archiveTask,
    setCanvasPinned,
    isPersonal,
    meUuid,
    meName,
  ]);

  return { items, meUuid, meName };
}
