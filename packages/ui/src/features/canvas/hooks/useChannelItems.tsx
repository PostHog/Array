import {
  buildChannelItems,
  type ChannelItemModel,
  type ChannelItemOwner,
} from "@posthog/core/canvas/channelItems";
import { useArchivedTaskIds } from "@posthog/ui/features/archive/useArchivedTaskIds";
import { useArchiveTask } from "@posthog/ui/features/archive/useArchiveTask";
import { useOptionalAuthenticatedClient } from "@posthog/ui/features/auth/authClient";
import { useCurrentUser } from "@posthog/ui/features/auth/useCurrentUser";
import type { ChannelItemActions } from "@posthog/ui/features/canvas/components/ChannelItemRow";
import { useChannelFeed } from "@posthog/ui/features/canvas/hooks/useChannelFeed";
import { useChannels } from "@posthog/ui/features/canvas/hooks/useChannels";
import {
  useDashboardMutations,
  useDashboards,
} from "@posthog/ui/features/canvas/hooks/useDashboards";
import { userDisplayName } from "@posthog/ui/features/canvas/utils/userDisplay";
import { usePinnedTasks } from "@posthog/ui/features/sidebar/usePinnedTasks";
import { toast } from "@posthog/ui/primitives/toast";
import { useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";

/**
 * A channel's canvases + task feed as merged, newest-first items, plus the row
 * actions and the viewer's identity for the recent-list filters.
 *
 * The channel is looked up in the channels list to establish its identity
 * (personal vs public). While it's unknown the hook reports loading and yields
 * nothing — which keeps the personal-channel ownership filter from running
 * against an identity we haven't established yet.
 */
export function useChannelItems(channelId: string): {
  items: ChannelItemModel[];
  actions: ChannelItemActions;
  /** Who the viewer is, for the created-by filter. */
  me: ChannelItemOwner;
  isLoading: boolean;
  /** The channel id resolves to no channel in this project. */
  channelMissing: boolean;
} {
  const navigate = useNavigate();

  const { channels, isLoading: channelsLoading } = useChannels();
  const channel = channels.find((c) => c.id === channelId);
  const identityKnown = channel !== undefined;
  const isPersonal = channel?.channelType === "personal";

  const { dashboards, isLoading: dashboardsLoading } = useDashboards(channelId);
  const { tasks: feedTasks, isLoading: feedLoading } =
    useChannelFeed(channelId);
  const archivedTaskIds = useArchivedTaskIds();
  const { pinnedTaskIds, togglePin } = usePinnedTasks();
  const { archiveTask } = useArchiveTask({ navigateSpace: "website" });
  const { setPinned: setCanvasPinned } = useDashboardMutations();
  const client = useOptionalAuthenticatedClient();
  const { data: currentUser, isLoading: viewerLoading } = useCurrentUser({
    client,
  });

  const meUuid = currentUser?.uuid ?? null;
  const meName = currentUser ? userDisplayName(currentUser) : null;
  const me = useMemo<ChannelItemOwner>(
    () => ({ uuid: meUuid, name: meName }),
    [meUuid, meName],
  );
  const viewerKnown = meUuid != null || meName != null;

  const items = useMemo<ChannelItemModel[]>(
    () =>
      identityKnown && (!isPersonal || viewerKnown)
        ? buildChannelItems({
            dashboards,
            feedTasks,
            archivedTaskIds,
            pinnedTaskIds,
            // The personal channel is yours — but don't filter until we know
            // who you are, or #me flashes everyone's items on a cold load.
            ownedBy: isPersonal && viewerKnown ? me : null,
          })
        : [],
    [
      identityKnown,
      dashboards,
      feedTasks,
      archivedTaskIds,
      pinnedTaskIds,
      isPersonal,
      viewerKnown,
      me,
    ],
  );

  const actions = useMemo<ChannelItemActions>(
    () => ({
      open: (item) => {
        if (item.kind === "canvas") {
          void navigate({
            to: "/website/$channelId/dashboards/$dashboardId",
            params: { channelId, dashboardId: item.id },
          });
        } else {
          void navigate({
            to: "/website/$channelId/tasks/$taskId",
            params: { channelId, taskId: item.id },
          });
        }
      },
      togglePin: (item) => {
        const pin =
          item.kind === "canvas"
            ? setCanvasPinned(item.id, !item.pinned)
            : togglePin(item.id);
        pin.catch(() => {
          toast.error("Couldn't update pin");
        });
      },
      archive: (item) => {
        void archiveTask({ taskId: item.id });
      },
    }),
    [channelId, navigate, setCanvasPinned, togglePin, archiveTask],
  );

  // A channel that isn't in the list will never resolve, so stop reporting
  // loading and let the caller say so instead of spinning forever.
  const channelMissing = !channelsLoading && !channel;

  return {
    items,
    actions,
    me,
    isLoading:
      !channelMissing &&
      (channelsLoading ||
        !identityKnown ||
        dashboardsLoading ||
        feedLoading ||
        (isPersonal && viewerLoading)),
    channelMissing,
  };
}
