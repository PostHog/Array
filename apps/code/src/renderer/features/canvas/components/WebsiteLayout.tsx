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
import type { Spec } from "@json-render/react";
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
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  Input,
} from "@posthog/quill";
import { Box, Flex, Text } from "@radix-ui/themes";
import {
  Link,
  Outlet,
  useNavigate,
  useParams,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

function threadIdFor(dashboardId: string): string {
  return `dashboard:${dashboardId}`;
}

// Shared text metrics so the name display and its inline input occupy the same
// box (no layout shift when toggling). 1px border on both; transparent until
// hover on the display.
const NAME_TEXT = "h-[22px] px-1 text-[13px] font-medium leading-none";

// The dashboards switcher (view mode): a Quill combobox to switch dashboards.
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

// Inline-editable dashboard name (edit mode). Click the name to rename in place;
// commits on Enter/blur. Reports its editing state up so Save can disable while
// renaming and re-enable on blur.
function EditableDashboardName({
  dashboardId,
  onRenamingChange,
}: {
  dashboardId: string;
  onRenamingChange: (renaming: boolean) => void;
}) {
  const { dashboard } = useDashboard(dashboardId);
  const { saveDashboard } = useDashboardMutations();
  const name = dashboard?.name ?? "Dashboard";

  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const start = () => {
    setValue(name);
    setEditing(true);
    onRenamingChange(true);
  };

  const commit = () => {
    setEditing(false);
    onRenamingChange(false);
    const next = value.trim();
    if (next && next !== name) {
      // Rename without touching the spec: persist the saved spec + new name.
      void saveDashboard(
        dashboardId,
        (dashboard?.spec ?? null) as unknown as Spec,
        next,
      );
    }
  };

  const cancel = () => {
    setEditing(false);
    onRenamingChange(false);
  };

  if (editing) {
    return (
      <Input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            cancel();
          }
        }}
        className={`no-drag ${NAME_TEXT} min-h-0 w-auto rounded text-gray-12`}
        style={{ width: `${Math.max(value.length, 4)}ch` }}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={start}
      title="Rename dashboard"
      className={`no-drag inline-flex items-center rounded border border-transparent text-gray-12 hover:border-gray-6 ${NAME_TEXT}`}
    >
      {name}
    </button>
  );
}

// Edit toggle + (in edit mode) Save (via name dialog) / Save-as-fork.
function DashboardControls({
  dashboardId,
  renaming,
}: {
  dashboardId: string;
  renaming: boolean;
}) {
  const navigate = useNavigate();
  const editing = useIsDashboardEditing(dashboardId);
  const toggle = useDashboardEditStore((s) => s.toggle);
  const setEditing = useDashboardEditStore((s) => s.setEditing);

  const { dashboard } = useDashboard(dashboardId);
  const { spec: liveSpec } = useCanvasThread(threadIdFor(dashboardId));
  const { saveDashboard, createDashboard, isSaving } = useDashboardMutations();

  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");

  const savedSpec = dashboard?.spec ?? null;
  const hasSpec = isNonEmptySpec(liveSpec);
  const dirty =
    hasSpec && JSON.stringify(liveSpec) !== JSON.stringify(savedSpec);

  const openSaveDialog = () => {
    setSaveName(dashboard?.name ?? "Dashboard");
    setSaveOpen(true);
  };

  const confirmSave = () => {
    const name = saveName.trim();
    void saveDashboard(dashboardId, liveSpec, name || undefined);
    setSaveOpen(false);
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
      {editing && (
        <>
          <Button
            variant="primary"
            size="sm"
            disabled={!dirty || isSaving || renaming}
            onClick={openSaveDialog}
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

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="w-[400px] max-w-[90vw]">
          <DialogTitle>Save dashboard</DialogTitle>
          <Flex direction="column" gap="3" pt="2">
            <Input
              autoFocus
              value={saveName}
              placeholder="Dashboard name"
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && saveName.trim()) {
                  e.preventDefault();
                  confirmSave();
                }
              }}
            />
            <Flex justify="end" gap="2">
              <DialogClose
                render={
                  <Button variant="outline" size="sm">
                    Cancel
                  </Button>
                }
              />
              <Button
                variant="primary"
                size="sm"
                disabled={!saveName.trim() || isSaving}
                onClick={confirmSave}
              >
                Save
              </Button>
            </Flex>
          </Flex>
        </DialogContent>
      </Dialog>
    </Flex>
  );
}

// Breadcrumb topbar + content outlet for the Website space.
export function WebsiteLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const params = useParams({ strict: false });
  const { data: tasks } = useTasks();
  const [renaming, setRenaming] = useState(false);

  const dashboardId = params.dashboardId;
  const isDashboards =
    pathname.startsWith("/website/dashboards") && dashboardId;
  const editingDashboard = useIsDashboardEditing(dashboardId ?? "");
  const taskId = params.taskId;

  let secondCrumb: React.ReactNode = null;
  if (isDashboards) {
    secondCrumb = editingDashboard ? (
      <EditableDashboardName
        dashboardId={dashboardId}
        onRenamingChange={setRenaming}
      />
    ) : (
      <DashboardPicker dashboardId={dashboardId} />
    );
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
        {isDashboards && (
          <DashboardControls dashboardId={dashboardId} renaming={renaming} />
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
