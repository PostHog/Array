import { isNonEmptySpec } from "@json-render/core";
import {
  FunnelIcon,
  GitForkIcon,
  PencilSimpleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { Button } from "@posthog/quill";
import { DashboardDateRangeControl } from "@posthog/ui/features/canvas/components/DashboardDateRangeControl";
import { DashboardRefreshControl } from "@posthog/ui/features/canvas/components/DashboardRefreshControl";
import { NewCanvasMenu } from "@posthog/ui/features/canvas/components/NewCanvasMenu";
import { dashboardTitleFromSpec } from "@posthog/ui/features/canvas/genui/dashboardTitle";
import {
  useDashboard,
  useDashboardMutations,
} from "@posthog/ui/features/canvas/hooks/useDashboards";
import {
  useCanvasChatStore,
  useCanvasThread,
} from "@posthog/ui/features/canvas/stores/canvasChatStore";
import {
  useDashboardEditStore,
  useIsDashboardEditing,
} from "@posthog/ui/features/canvas/stores/dashboardEditStore";
import { toast } from "@posthog/ui/primitives/toast";
import { useHeaderStore } from "@posthog/ui/shell/headerStore";
import { Box, Flex } from "@radix-ui/themes";
import {
  Outlet,
  useNavigate,
  useParams,
  useRouterState,
} from "@tanstack/react-router";

function threadIdFor(dashboardId: string): string {
  return `dashboard:${dashboardId}`;
}

// Templates whose canvases carry the data toolbar (Filter + date range +
// refresh) — the ones with refreshable, time-scoped queries.
const DATA_TEMPLATES = ["dashboard", "web-analytics"];

// Edit toggle + (in edit mode) Save / Save-as-fork for the active dashboard.
// Sits on the right of the single canvas toolbar, beside the refresh control.
function DashboardEditControls({
  channelId,
  dashboardId,
}: {
  channelId: string;
  dashboardId: string;
}) {
  const navigate = useNavigate();
  const editing = useIsDashboardEditing(dashboardId);
  const setEditing = useDashboardEditStore((s) => s.setEditing);
  const resetThread = useCanvasChatStore((s) => s.reset);

  const threadId = threadIdFor(dashboardId);
  const { dashboard } = useDashboard(dashboardId);
  const { spec: liveSpec } = useCanvasThread(threadId);
  const { saveDashboard, createDashboard, isSaving } = useDashboardMutations();

  const savedSpec = dashboard?.spec ?? null;
  const hasSpec = isNonEmptySpec(liveSpec);
  const dirty =
    hasSpec && JSON.stringify(liveSpec) !== JSON.stringify(savedSpec);

  const onSave = () => {
    if (!dirty) return;
    // The h1 title is the dashboard's name: sync it to the file on every save so
    // renaming the canvas title renames the saved dashboard.
    saveDashboard(
      dashboardId,
      liveSpec,
      dashboardTitleFromSpec(liveSpec),
    ).catch((error) => {
      toast.error("Couldn't save dashboard", {
        description: error instanceof Error ? error.message : String(error),
      });
    });
  };

  const onFork = async () => {
    if (!hasSpec) return;
    try {
      const title =
        dashboardTitleFromSpec(liveSpec) ?? dashboard?.name ?? "Canvas";
      const name = `${title} (fork)`;
      const record = await createDashboard(channelId, name, liveSpec);
      setEditing(record.id, true);
      void navigate({
        to: "/website/$channelId/dashboards/$dashboardId",
        params: { channelId, dashboardId: record.id },
      });
    } catch (error) {
      toast.error("Couldn't fork dashboard", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const onToggleEdit = () => {
    if (editing) {
      // Cancel: drop unsaved edits. Resetting the thread clears the live spec so
      // re-entering edit re-seeds from the saved dashboard; the file is untouched.
      void resetThread(threadId);
      setEditing(dashboardId, false);
    } else {
      setEditing(dashboardId, true);
    }
  };

  return (
    <Flex align="center" gap="2" className="no-drag">
      {editing && (
        <>
          <Button
            variant="primary"
            size="sm"
            disabled={!dirty || isSaving}
            onClick={onSave}
          >
            Save
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!hasSpec}
            onClick={onFork}
          >
            <GitForkIcon size={14} />
            Save as fork
          </Button>
        </>
      )}
      <Button
        variant="outline"
        size="sm"
        data-selected={editing}
        onClick={onToggleEdit}
      >
        {editing ? (
          <XIcon size={14} />
        ) : (
          <PencilSimpleIcon size={14} weight="regular" />
        )}
        {editing ? "Cancel" : "Edit"}
      </Button>
    </Flex>
  );
}

// Canvas toolbar + content outlet for the Website space (channel-scoped). No
// breadcrumb row — a single toolbar carries the data controls and actions.
export function WebsiteLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const params = useParams({ strict: false });

  // App pages mirrored into the Channels space (Home, Skills, MCP servers,
  // Command Center) are channel-less and push their title into the shared
  // header store. With no code HeaderRow here, surface that title in this bar so
  // the mirrored pages read the same as in Code.
  const headerContent = useHeaderStore((s) => s.content);

  const channelId = params.channelId;
  const dashboardId = params.dashboardId;
  const base = channelId ? `/website/${channelId}` : "/website";

  const isDashboardDetail = Boolean(channelId && dashboardId);
  // The dashboards grid (a channel with no sub-view selected).
  const isDashboardsGrid = Boolean(channelId) && pathname === base;
  const editing = useIsDashboardEditing(dashboardId ?? "");

  // The data controls (Filter + date range + query refresh) are data-template
  // chrome: only the data-driven templates (Dashboard, Web analytics) have
  // refreshable, time-scoped queries. A Blank canvas shows none of it. Legacy
  // canvases (no templateId) default to "dashboard", so they keep the toolbar.
  const { dashboard } = useDashboard(dashboardId ?? "");
  const isDataTemplate = DATA_TEMPLATES.includes(
    dashboard?.templateId ?? "dashboard",
  );

  // Whether the single toolbar should render: the canvases grid, or any single
  // canvas (including Blank/Freeform, so Edit lives here too).
  const showToolbar =
    Boolean(channelId) && (isDashboardsGrid || isDashboardDetail);
  // The left-hand data controls (Filter + date range) only apply to the grid and
  // data-template canvases.
  const showDataControls =
    isDashboardsGrid || (isDashboardDetail && isDataTemplate);

  return (
    <Flex direction="column" height="100%" overflow="hidden">
      {/* Channel-less mirrored pages (Home, Skills, MCP servers, Command Center)
          push a title into the header store; surface it so they keep a title bar
          even though the Channels space has no code HeaderRow. */}
      {!channelId && headerContent && (
        <Flex
          align="center"
          gap="2"
          className="h-10 shrink-0 border-gray-6 border-b px-3"
        >
          {headerContent}
        </Flex>
      )}

      {/* Single canvas toolbar (no breadcrumb row): data controls on the left,
          actions (Edit / Save / New canvas) on the right. */}
      {showToolbar && (
        <Flex
          align="center"
          justify="between"
          gap="2"
          className="h-10 shrink-0 border-gray-6 border-b px-3"
        >
          <Flex align="center" gap="2">
            {showDataControls && (
              // Placeholder — filtering isn't wired up yet, so keep it disabled.
              <Button variant="outline" size="sm" disabled>
                <FunnelIcon size={14} />
                Filter
              </Button>
            )}
            {/* Shown in edit too: changing it directs the agent's next build at
                the chosen window (refresh in view, prompt hint in edit). */}
            {isDashboardDetail && dashboardId && isDataTemplate && (
              <DashboardDateRangeControl dashboardId={dashboardId} />
            )}
          </Flex>
          <Flex align="center" gap="2">
            {isDashboardDetail && dashboardId && isDataTemplate && !editing && (
              <DashboardRefreshControl dashboardId={dashboardId} />
            )}
            {isDashboardDetail && channelId && dashboardId ? (
              <DashboardEditControls
                channelId={channelId}
                dashboardId={dashboardId}
              />
            ) : isDashboardsGrid && channelId ? (
              <NewCanvasMenu channelId={channelId} />
            ) : null}
          </Flex>
        </Flex>
      )}
      <Box flexGrow="1" overflow="hidden">
        <Outlet />
      </Box>
    </Flex>
  );
}
