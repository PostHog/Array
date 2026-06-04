import { getDashboard, WEBSITE_DASHBOARDS } from "@features/canvas/dashboards";
import {
  useDashboardEditStore,
  useIsDashboardEditing,
} from "@features/canvas/stores/dashboardEditStore";
import { useTasks } from "@features/tasks/hooks/useTasks";
import {
  CaretDownIcon,
  CaretRightIcon,
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
import { useRef, useState } from "react";

const DASHBOARD_IDS = WEBSITE_DASHBOARDS.map((d) => d.id);

// The dashboards breadcrumb crumb: a Quill combobox to switch the active
// dashboard by name. Selecting navigates to that dashboard's route.
function DashboardPicker({ dashboardId }: { dashboardId?: string }) {
  const navigate = useNavigate();
  const anchorRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const current = getDashboard(dashboardId);

  return (
    <Combobox
      items={DASHBOARD_IDS}
      value={current.id}
      // No search input here — disable filtering so every dashboard always
      // shows (otherwise base-ui filters the list down to the selected one).
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
            <Button variant="outline" size="sm" title={current.name}>
              <span className="min-w-0 truncate">{current.name}</span>
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
            const dashboard = getDashboard(id);
            return (
              <ComboboxItem key={id} value={id}>
                {dashboard.name}
              </ComboboxItem>
            );
          }}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

// Toggles the active dashboard's edit mode (gen-UI canvas + chat input).
function EditButton({ dashboardId }: { dashboardId?: string }) {
  const id = getDashboard(dashboardId).id;
  const editing = useIsDashboardEditing(id);
  const toggle = useDashboardEditStore((s) => s.toggle);

  return (
    <Button
      variant="outline"
      size="sm"
      data-selected={editing}
      className="no-drag ml-auto"
      onClick={() => toggle(id)}
    >
      <PencilSimpleIcon size={14} weight={editing ? "fill" : "regular"} />
      Edit
    </Button>
  );
}

// Breadcrumb topbar + content outlet for the Website space.
export function WebsiteLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const params = useParams({ strict: false });
  const { data: tasks } = useTasks();

  const isDashboards = pathname.startsWith("/website/dashboards");
  const taskId = params.taskId;

  let secondCrumb: React.ReactNode = null;
  if (isDashboards) {
    secondCrumb = <DashboardPicker dashboardId={params.dashboardId} />;
  } else if (pathname.startsWith("/website/new")) {
    secondCrumb = <CrumbText>New task</CrumbText>;
  } else if (pathname.startsWith("/website/settings")) {
    secondCrumb = <CrumbText>Settings</CrumbText>;
  } else if (taskId) {
    const title = tasks?.find((t) => t.id === taskId)?.title;
    secondCrumb = <CrumbText>{title || "Task"}</CrumbText>;
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
        {secondCrumb && (
          <>
            <CaretRightIcon size={12} className="text-gray-8" />
            {secondCrumb}
          </>
        )}
        {isDashboards && <EditButton dashboardId={params.dashboardId} />}
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
