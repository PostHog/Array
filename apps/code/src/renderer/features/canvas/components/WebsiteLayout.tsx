import { DashboardRefreshControl } from "@features/canvas/components/DashboardRefreshControl";
import {
  useDashboard,
  useDashboardMutations,
  useDashboards,
} from "@features/canvas/hooks/useDashboards";
import { useCanvasThread } from "@features/canvas/stores/canvasChatStore";
import {
  useDashboardEditStore,
  useIsDashboardEditing,
} from "@features/canvas/stores/dashboardEditStore";
import { useTasks } from "@features/tasks/hooks/useTasks";
import { isNonEmptySpec } from "@json-render/core";
import {
  CaretDownIcon,
  CaretRightIcon,
  GitForkIcon,
  PencilSimpleIcon,
} from "@phosphor-icons/react";
import {
  Button,
  Combobox,
  ComboboxContent,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from "@posthog/quill";
import { Box, Flex, Text } from "@radix-ui/themes";
import {
  Link,
  Outlet,
  useNavigate,
  useParams,
  useRouterState,
} from "@tanstack/react-router";
import { Fragment, useRef, useState } from "react";

function threadIdFor(dashboardId: string): string {
  return `dashboard:${dashboardId}`;
}

// The dashboards breadcrumb crumb: a Quill combobox to switch the active
// dashboard by name. Selecting navigates to that dashboard's route.
function DashboardPicker({ dashboardId }: { dashboardId: string }) {
  const navigate = useNavigate();
  const anchorRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const { dashboards } = useDashboards();

  const currentName =
    dashboards.find((d) => d.id === dashboardId)?.name ?? "Dashboard";

  return (
    <Combobox
      items={dashboards.map((d) => d.id)}
      value={dashboardId}
      // No search input — disable filtering so all dashboards always show.
      filter={null}
      onValueChange={(value) =>
        navigate({
          to: "/website/dashboards/$dashboardId",
          params: { dashboardId: value as string },
        })
      }
      open={open}
      onOpenChange={setOpen}
    >
      <div ref={anchorRef} className="no-drag inline-flex">
        <ComboboxTrigger
          render={
            <Button variant="outline" size="sm" title={currentName}>
              <span className="min-w-0 truncate">{currentName}</span>
              <CaretDownIcon size={10} weight="bold" className="text-gray-9" />
            </Button>
          }
        />
      </div>
      <ComboboxContent
        anchor={anchorRef}
        side="bottom"
        sideOffset={6}
        className="min-w-[220px]"
      >
        <ComboboxList>
          {(id: string) => {
            const name = dashboards.find((d) => d.id === id)?.name ?? id;
            return (
              <ComboboxItem key={id} value={id}>
                {name}
              </ComboboxItem>
            );
          }}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

// Edit toggle + (in edit mode) Save / Save-as-fork for the active dashboard.
function DashboardControls({ dashboardId }: { dashboardId: string }) {
  const navigate = useNavigate();
  const editing = useIsDashboardEditing(dashboardId);
  const toggle = useDashboardEditStore((s) => s.toggle);
  const setEditing = useDashboardEditStore((s) => s.setEditing);

  const { dashboard } = useDashboard(dashboardId);
  const { spec: liveSpec } = useCanvasThread(threadIdFor(dashboardId));
  const { saveDashboard, createDashboard, isSaving } = useDashboardMutations();

  const savedSpec = dashboard?.spec ?? null;
  const hasSpec = isNonEmptySpec(liveSpec);
  const dirty =
    hasSpec && JSON.stringify(liveSpec) !== JSON.stringify(savedSpec);

  const onSave = () => {
    if (!dirty) return;
    void saveDashboard(dashboardId, liveSpec);
  };

  const onFork = async () => {
    if (!hasSpec) return;
    const name = `${dashboard?.name ?? "Dashboard"} (fork)`;
    const record = await createDashboard(name, liveSpec);
    setEditing(record.id, true);
    void navigate({
      to: "/website/dashboards/$dashboardId",
      params: { dashboardId: record.id },
    });
  };

  return (
    <Flex align="center" gap="2" className="no-drag ml-auto">
      <DashboardRefreshControl dashboardId={dashboardId} />
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
        onClick={() => toggle(dashboardId)}
      >
        <PencilSimpleIcon size={14} weight={editing ? "fill" : "regular"} />
        Edit
      </Button>
    </Flex>
  );
}

// Breadcrumb topbar + content outlet for the Website space.
export function WebsiteLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const params = useParams({ strict: false });
  const { data: tasks } = useTasks();

  const dashboardId = params.dashboardId;
  const isDashboardsIndex = pathname === "/website";
  const isDashboardDetail =
    pathname.startsWith("/website/dashboards") && Boolean(dashboardId);
  const taskId = params.taskId;

  // Breadcrumb segments after the root "Website" crumb. Dashboards always show
  // a "Dashboards" crumb (linking back to the index from a detail view), then
  // the active dashboard's name picker when viewing one.
  const crumbs: React.ReactNode[] = [];
  if (isDashboardsIndex) {
    crumbs.push(<CrumbText key="dashboards">Dashboards</CrumbText>);
  } else if (isDashboardDetail && dashboardId) {
    crumbs.push(
      <Link key="dashboards" to="/website" className="no-drag">
        <Text
          size="1"
          weight="medium"
          className="text-gray-10 hover:text-gray-12"
        >
          Dashboards
        </Text>
      </Link>,
      <DashboardPicker key="picker" dashboardId={dashboardId} />,
    );
  } else if (pathname.startsWith("/website/new")) {
    crumbs.push(<CrumbText key="new">New task</CrumbText>);
  } else if (pathname.startsWith("/website/settings")) {
    crumbs.push(<CrumbText key="settings">Settings</CrumbText>);
  } else if (taskId) {
    const title = tasks?.find((t) => t.id === taskId)?.title;
    crumbs.push(<CrumbText key="task">{title || "Task"}</CrumbText>);
  }

  return (
    <Flex direction="column" height="100%" overflow="hidden">
      <Flex
        align="center"
        gap="1"
        px="3"
        className="drag h-9 shrink-0 border-gray-6 border-b"
      >
        <Link to="/website" className="no-drag">
          <Text size="1" className="text-gray-10 hover:text-gray-12">
            Website
          </Text>
        </Link>
        {crumbs.map((crumb, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: crumb order is stable
          <Fragment key={i}>
            <CaretRightIcon size={12} className="text-gray-8" />
            {crumb}
          </Fragment>
        ))}
        {isDashboardDetail && dashboardId && (
          <DashboardControls dashboardId={dashboardId} />
        )}
      </Flex>
      <Box flexGrow="1" overflow="hidden">
        <Outlet />
      </Box>
    </Flex>
  );
}

function CrumbText({ children }: { children: React.ReactNode }) {
  return (
    <Text size="1" weight="medium" className="text-gray-12">
      {children}
    </Text>
  );
}
