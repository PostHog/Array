import {
  ArchiveIcon,
  ArrowElbowDownRightIcon,
  CaretDownIcon,
  ChartBarIcon,
  CodeIcon,
  DotsThreeIcon,
  FileTextIcon,
  FolderIcon,
  HashIcon,
  PencilSimpleIcon,
  PlusIcon,
  StarIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import type { DashboardSummary } from "@posthog/core/canvas/dashboardSchemas";
import type { TaskData } from "@posthog/core/sidebar/sidebarData.types";
import {
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  ButtonGroup,
  Collapsible,
  CollapsibleContent,
  CollapsibleHeader,
  CollapsibleTrigger,
  AlertDialog as ConfirmDialog,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  MenuLabel,
  Separator,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@posthog/quill";
import type { WorkspaceMode } from "@posthog/shared";
import { ANALYTICS_EVENTS } from "@posthog/shared/analytics-events";
import type { Task } from "@posthog/shared/domain-types";
import { useArchivedTaskIds } from "@posthog/ui/features/archive/useArchivedTaskIds";
import { useArchiveTask } from "@posthog/ui/features/archive/useArchiveTask";
import { CreateChannelModal } from "@posthog/ui/features/canvas/components/CreateChannelModal";
import { iconForTemplate } from "@posthog/ui/features/canvas/components/canvasTemplateIcon";
import {
  NewCanvasDialog,
  trackAndCreateCanvas,
} from "@posthog/ui/features/canvas/components/NewCanvasMenu";
import { RenameChannelModal } from "@posthog/ui/features/canvas/components/RenameChannelModal";
import { useCanvasTemplates } from "@posthog/ui/features/canvas/hooks/useCanvasTemplates";
import {
  useChannelStars,
  useChannelStarToggle,
} from "@posthog/ui/features/canvas/hooks/useChannelStars";
import {
  type Channel,
  useChannelMutations,
  useChannels,
} from "@posthog/ui/features/canvas/hooks/useChannels";
import { useChannelTaskData } from "@posthog/ui/features/canvas/hooks/useChannelTaskData";
import {
  useChannelTaskMutations,
  useChannelTasks,
  usePrefetchChannelTasks,
} from "@posthog/ui/features/canvas/hooks/useChannelTasks";
import {
  useCreateAndOpenDashboard,
  useDashboardMutations,
  useDashboards,
  useOpenHomeCanvas,
  usePrefetchDashboards,
} from "@posthog/ui/features/canvas/hooks/useDashboards";
import { useNestedGenerationTaskIds } from "@posthog/ui/features/canvas/hooks/useNestedGenerationTaskIds";
import { useSessionForTask } from "@posthog/ui/features/sessions/useSession";
import { TaskIcon } from "@posthog/ui/features/sidebar/components/items/TaskIcon";
import {
  type SidebarPrState,
  useTaskPrStatus,
} from "@posthog/ui/features/sidebar/useTaskPrStatus";
import { HeaderTitleEditor } from "@posthog/ui/features/task-detail/HeaderTitleEditor";
import { useTasks } from "@posthog/ui/features/tasks/useTasks";
import { useWorkspace } from "@posthog/ui/features/workspace/useWorkspace";
import { toast } from "@posthog/ui/primitives/toast";
import { track } from "@posthog/ui/shell/analytics";
import { Box, Flex, Text } from "@radix-ui/themes";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { Fragment, type ReactNode, useEffect, useRef, useState } from "react";
import { hostClient } from "../hostClient";

// Cap how many tasks each channel shows by default; the rest hide behind a
// "View more" button so a busy channel doesn't dominate the sidebar.
const MAX_VISIBLE_TASKS_PER_CHANNEL = 5;

// Short "x ago" stamp for an item's subtitle. Coarse on purpose — the sidebar
// just needs recency at a glance, not a precise duration.
function relativeTime(ms: number): string {
  const diff = Math.max(0, Date.now() - ms);
  const min = 60_000;
  const hr = 60 * min;
  const day = 24 * hr;
  if (diff < hr) return `${Math.max(1, Math.round(diff / min))}m ago`;
  if (diff < day) return `${Math.round(diff / hr)}h ago`;
  const days = Math.round(diff / day);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

// One actionable entry in a channel's menu, rendered the same whether it
// surfaces in the hover "..." dropdown or the right-click context menu.
type ChannelActionItem = {
  key: string;
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  variant?: "destructive";
  disabled?: boolean;
  // Draw a divider above this item to separate it from the previous group.
  separatorBefore?: boolean;
};

// The channel actions (star, edit context, rename, delete) plus the rename-modal
// state they drive. Single source of truth so the dropdown and context menus
// stay in lockstep — add an action here and both surfaces pick it up.
function useChannelActions(channel: Channel): {
  actions: ChannelActionItem[];
  renameOpen: boolean;
  setRenameOpen: (open: boolean) => void;
  confirmDeleteOpen: boolean;
  setConfirmDeleteOpen: (open: boolean) => void;
  confirmDelete: () => Promise<boolean>;
  isDeleting: boolean;
} {
  const [renameOpen, setRenameOpen] = useState(false);
  // "Delete channel" opens a confirmation dialog rather than deleting inline —
  // the action is destructive and irreversible.
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { deleteChannel, isDeleting } = useChannelMutations();
  const { isStarred, toggleStar, removeStar } = useChannelStarToggle(channel);

  // Runs the actual delete once confirmed. Returns whether it succeeded so the
  // dialog can stay open (and show the toast) on failure.
  const confirmDelete = async (): Promise<boolean> => {
    try {
      // Unfile the channel's dashboards + filed tasks first. The folder delete
      // would also cascade, but doing it explicitly via the typed endpoints
      // surfaces failures clearly. Best-effort — a failed child shouldn't
      // block removing the channel.
      const [dashboards, channelTasks] = await Promise.all([
        hostClient().dashboards.list.query({ channelId: channel.id }),
        hostClient().channelTasks.list.query({ channelId: channel.id }),
      ]);
      await Promise.allSettled([
        ...dashboards.map((d) =>
          hostClient().dashboards.delete.mutate({ id: d.id }),
        ),
        ...channelTasks.map((t) =>
          hostClient().channelTasks.unfile.mutate({ id: t.id }),
        ),
      ]);

      await deleteChannel(channel.id);
      removeStar();
      track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
        action_type: "delete",
        surface: "sidebar",
        channel_id: channel.id,
        success: true,
      });
      // If we're inside the channel being deleted, fall back to the index.
      if (pathname.startsWith(`/website/${channel.id}`)) {
        void navigate({ to: "/website" });
      }
      return true;
    } catch (error) {
      track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
        action_type: "delete",
        surface: "sidebar",
        channel_id: channel.id,
        success: false,
      });
      toast.error("Couldn't delete channel", {
        description: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  };

  const actions: ChannelActionItem[] = [
    {
      key: "star",
      label: isStarred ? "Unstar channel" : "Star channel",
      icon: <StarIcon size={14} weight={isStarred ? "fill" : "regular"} />,
      onSelect: () => {
        track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
          action_type: isStarred ? "unstar" : "star",
          surface: "sidebar",
          channel_id: channel.id,
        });
        toggleStar();
      },
    },
    {
      key: "edit-context",
      label: "Edit CONTEXT.md",
      icon: <FileTextIcon size={14} />,
      separatorBefore: true,
      onSelect: () => {
        track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
          action_type: "edit_context_open",
          surface: "sidebar",
          channel_id: channel.id,
        });
        navigate({
          to: "/website/$channelId/context",
          params: { channelId: channel.id },
        });
      },
    },
    {
      key: "rename",
      label: "Rename channel…",
      icon: <PencilSimpleIcon size={14} />,
      separatorBefore: true,
      onSelect: () => setRenameOpen(true),
    },
    {
      key: "delete",
      label: "Delete channel…",
      icon: <TrashIcon size={14} />,
      variant: "destructive",
      onSelect: () => setConfirmDeleteOpen(true),
    },
  ];

  return {
    actions,
    renameOpen,
    setRenameOpen,
    confirmDeleteOpen,
    setConfirmDeleteOpen,
    confirmDelete,
    isDeleting,
  };
}

// Renders the shared channel actions into either menu primitive. Branching by
// `kind` (rather than a union-typed component) keeps the item/separator props
// type-checked against each primitive.
function ChannelActionItems({
  actions,
  kind,
}: {
  actions: ChannelActionItem[];
  kind: "dropdown" | "context";
}) {
  if (kind === "dropdown") {
    return (
      <>
        {actions.map((a) => (
          <Fragment key={a.key}>
            {a.separatorBefore && <DropdownMenuSeparator />}
            <DropdownMenuItem
              variant={a.variant}
              disabled={a.disabled}
              onClick={a.onSelect}
            >
              {a.icon}
              {a.label}
            </DropdownMenuItem>
          </Fragment>
        ))}
      </>
    );
  }
  return (
    <>
      {actions.map((a) => (
        <Fragment key={a.key}>
          {a.separatorBefore && <ContextMenuSeparator />}
          <ContextMenuItem
            variant={a.variant}
            disabled={a.disabled}
            onClick={a.onSelect}
          >
            {a.icon}
            {a.label}
          </ContextMenuItem>
        </Fragment>
      ))}
    </>
  );
}

// Hover-revealed "..." menu on a channel header. Presentation only — the action
// list comes from `useChannelActions`, so it matches the right-click menu.
function ChannelMenu({
  channelName,
  actions,
  open,
  onOpenChange,
}: {
  channelName: string;
  actions: ChannelActionItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="icon-xs"
            aria-label={`Options for ${channelName}`}
            className={cn(
              "group-hover:border-border",
              "transition-opacity",
              open ? "opacity-100" : "opacity-0 group-hover/chan:opacity-100",
            )}
          >
            <DotsThreeIcon size={14} weight="bold" />
          </Button>
        }
      />
      <DropdownMenuContent
        align="end"
        side="bottom"
        sideOffset={4}
        className="w-auto min-w-fit"
      >
        <ChannelActionItems actions={actions} kind="dropdown" />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// A two-line child row (title + muted subtitle). Height is auto so the subtitle
// never collides with the next row — the icon top-aligns with the title.
function ChildRow({
  icon,
  title,
  subtitle,
  active,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant="default"
      size="default"
      data-selected={active || undefined}
      onClick={onClick}
      className="h-auto w-full items-start justify-start gap-2 px-2 py-1 text-left data-selected:bg-fill-selected data-selected:text-gray-12"
    >
      <span className="mt-px shrink-0">{icon}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium text-[13px] text-gray-12 leading-tight">
          {title}
        </span>
        {subtitle ? (
          <span className="truncate text-[10px] text-muted-foreground/80 leading-tight">
            {subtitle}
          </span>
        ) : null}
      </span>
    </Button>
  );
}

// Shared right-click menu + hover tooltip for a task row inside a channel:
// File to… / Archive / Remove from channel. Used by both the regular filed
// TaskRow and the generation task nested under a canvas so they offer the same
// actions. "Remove from channel" only appears when the task is actually filed
// (has a channel task row) — `channelTaskId` is what `unfileTask` removes.
function TaskRowContextMenu({
  channelId,
  taskId,
  channelTaskId,
  title,
  channels,
  children,
}: {
  channelId: string;
  taskId: string;
  channelTaskId?: string;
  title: string;
  channels: Channel[];
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { fileTask, unfileTask } = useChannelTaskMutations();
  // Archiving from the bluebird/channels nav should return to the website
  // new-task screen, not the Code one.
  const { archiveTask } = useArchiveTask({ navigateSpace: "website" });

  const onFileTo = async (targetChannelId: string) => {
    try {
      await fileTask(targetChannelId, taskId, title);
      track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
        action_type: "file_task",
        surface: "sidebar",
        channel_id: channelId,
        target_channel_id: targetChannelId,
        task_id: taskId,
        success: true,
      });
    } catch (error) {
      track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
        action_type: "file_task",
        surface: "sidebar",
        channel_id: channelId,
        target_channel_id: targetChannelId,
        task_id: taskId,
        success: false,
      });
      toast.error("Couldn't file task", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const onArchive = async () => {
    try {
      await archiveTask({ taskId });
      track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
        action_type: "archive_task",
        surface: "sidebar",
        channel_id: channelId,
        task_id: taskId,
        success: true,
      });
    } catch (error) {
      track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
        action_type: "archive_task",
        surface: "sidebar",
        channel_id: channelId,
        task_id: taskId,
        success: false,
      });
      toast.error("Couldn't archive task", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const onRemove = async () => {
    if (!channelTaskId) return;
    try {
      await unfileTask(channelTaskId);
      track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
        action_type: "unfile_task",
        surface: "sidebar",
        channel_id: channelId,
        task_id: taskId,
        success: true,
      });
      if (pathname === `/website/${channelId}/tasks/${taskId}`) {
        void navigate({
          to: "/website/$channelId",
          params: { channelId },
        });
      }
    } catch (error) {
      track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
        action_type: "unfile_task",
        surface: "sidebar",
        channel_id: channelId,
        task_id: taskId,
        success: false,
      });
      toast.error("Couldn't remove task from channel", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <ContextMenu>
      <Tooltip>
        <ContextMenuTrigger
          render={<TooltipTrigger>{children}</TooltipTrigger>}
        />
        <TooltipContent side="right">{title}</TooltipContent>
      </Tooltip>
      <ContextMenuContent>
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <FolderIcon size={14} />
            File to…
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {channels.filter((c) => c.id !== channelId).length === 0 ? (
              <ContextMenuItem disabled>No other channels</ContextMenuItem>
            ) : (
              channels
                .filter((c) => c.id !== channelId)
                .map((c) => (
                  <ContextMenuItem
                    key={c.id}
                    onClick={() => void onFileTo(c.id)}
                  >
                    {c.name}
                  </ContextMenuItem>
                ))
            )}
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => void onArchive()}>
          <ArchiveIcon size={14} />
          Archive
        </ContextMenuItem>
        {channelTaskId ? (
          <ContextMenuItem
            variant="destructive"
            onClick={() => void onRemove()}
          >
            <XIcon size={14} />
            Remove from channel
          </ContextMenuItem>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  );
}

// The status icon shared by both channel task rows. Maps a row's derived
// `TaskData` onto the sidebar `<TaskIcon>` (cloud run status, PR state,
// generating / unread / pinned, etc.), falling back to a neutral code icon
// until the data loads. Defined once so `TaskRow` and `CanvasGenerationTaskRow`
// can't drift apart on icon fidelity.
function TaskStatusIcon({
  taskData,
  prState,
  hasDiff,
  workspaceMode,
  size,
}: {
  taskData: TaskData | undefined;
  prState: SidebarPrState;
  hasDiff: boolean;
  workspaceMode: WorkspaceMode | undefined;
  size: number;
}) {
  if (!taskData) {
    return <CodeIcon size={size} className="text-gray-9" />;
  }
  return (
    <TaskIcon
      workspaceMode={workspaceMode}
      isGenerating={taskData.isGenerating}
      isUnread={taskData.isUnread}
      isPinned={taskData.isPinned}
      isSuspended={taskData.isSuspended}
      needsPermission={taskData.needsPermission}
      taskRunStatus={taskData.taskRunStatus}
      originProduct={taskData.originProduct}
      slackThreadUrl={taskData.slackThreadUrl}
      prState={prState}
      hasDiff={hasDiff}
      size={size}
    />
  );
}

// The generation task tied to a canvas, shown nested beneath the canvas name
// while it's generating and afterwards until the user has seen the result (see
// useNestedGenerationTaskIds — the parent only renders this row when it should
// nest). Unlike a filed TaskRow this is a compact, single-line row — just the
// task icon and title (no status subtitle) — with a down-then-right elbow
// marking it as belonging to the canvas above it. Clicking opens the task;
// right-click offers the same actions as a regular task row.
function CanvasGenerationTaskRow({
  channelId,
  taskId,
  task,
  channelTaskId,
  channels,
}: {
  channelId: string;
  taskId: string;
  task: Task | undefined;
  channelTaskId?: string;
  channels: Channel[];
}) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const taskData = useChannelTaskData(task);
  const workspace = useWorkspace(taskId);
  const workspaceMode =
    workspace?.mode ??
    (taskData?.taskRunEnvironment === "cloud" ? "cloud" : undefined);
  const { prState, hasDiff } = useTaskPrStatus({
    id: taskId,
    cloudPrUrl: taskData?.cloudPrUrl ?? null,
    taskRunEnvironment: taskData?.taskRunEnvironment ?? null,
  });

  // Tasks are private to their creator; if the generation task isn't in this
  // user's list there's nothing to link to, so render nothing.
  if (!task) return null;

  const title = task.title || "Untitled task";
  const active = pathname === `/website/${channelId}/tasks/${taskId}`;
  const icon = (
    <TaskStatusIcon
      taskData={taskData}
      prState={prState}
      hasDiff={hasDiff}
      workspaceMode={workspaceMode}
      size={12}
    />
  );

  return (
    <TaskRowContextMenu
      channelId={channelId}
      taskId={taskId}
      channelTaskId={channelTaskId}
      title={title}
      channels={channels}
    >
      <Button
        variant="default"
        size="default"
        data-selected={active || undefined}
        onClick={() =>
          navigate({
            to: "/website/$channelId/tasks/$taskId",
            params: { channelId, taskId },
          })
        }
        className="h-auto w-full items-center justify-start gap-1 py-0.5 pr-2 pl-5 text-left data-selected:bg-fill-selected data-selected:text-gray-12"
      >
        <ArrowElbowDownRightIcon
          size={12}
          className="shrink-0 text-muted-foreground/70"
        />
        <span className="shrink-0">{icon}</span>
        <span className="truncate text-[11px] text-gray-11 leading-tight">
          {title}
        </span>
      </Button>
    </TaskRowContextMenu>
  );
}

// A single saved canvas under a channel — navigates to its detail view, with a
// right-click menu to rename (inline) or delete it.
function DashboardRow({
  channelId,
  dashboard,
  active,
  generationTask,
  generationChannelTaskId,
  channels,
}: {
  channelId: string;
  dashboard: DashboardSummary;
  active: boolean;
  // The canvas's generation task, when it should be shown nested below the
  // canvas name (decided by the channel via useNestedGenerationTaskIds).
  // Undefined when there's nothing to nest.
  generationTask?: Task;
  generationChannelTaskId?: string;
  channels: Channel[];
}) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { deleteDashboard, isDeleting, renameDashboard } =
    useDashboardMutations();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  // The name typed on a failed rename, kept so the retry keeps the user's text.
  const [renameDraft, setRenameDraft] = useState<string | null>(null);
  // Bumped on failure to remount the editor, resetting its one-shot submit guard.
  const [renameAttempt, setRenameAttempt] = useState(0);

  const closeRename = () => {
    setRenaming(false);
    setRenameDraft(null);
  };

  const onRename = async (next: string) => {
    try {
      await renameDashboard(dashboard.id, next);
      track(ANALYTICS_EVENTS.DASHBOARD_ACTION, {
        action_type: "rename",
        surface: "sidebar",
        channel_id: channelId,
        dashboard_id: dashboard.id,
        success: true,
      });
      closeRename();
    } catch (error) {
      // Keep the editor open with the typed text so the rename can be retried.
      setRenameDraft(next);
      setRenameAttempt((n) => n + 1);
      track(ANALYTICS_EVENTS.DASHBOARD_ACTION, {
        action_type: "rename",
        surface: "sidebar",
        channel_id: channelId,
        dashboard_id: dashboard.id,
        success: false,
      });
      toast.error("Couldn't rename canvas", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const onDelete = async () => {
    try {
      await deleteDashboard(dashboard.id);
      track(ANALYTICS_EVENTS.DASHBOARD_ACTION, {
        action_type: "delete",
        surface: "sidebar",
        channel_id: channelId,
        dashboard_id: dashboard.id,
        success: true,
      });
      // Deleting destroys the canvas, including any child routes under it, so
      // match the whole subtree (mirrors ChannelMenu.onDelete).
      if (
        pathname.startsWith(`/website/${channelId}/dashboards/${dashboard.id}`)
      ) {
        void navigate({
          to: "/website/$channelId",
          params: { channelId },
        });
      }
    } catch (error) {
      track(ANALYTICS_EVENTS.DASHBOARD_ACTION, {
        action_type: "delete",
        surface: "sidebar",
        channel_id: channelId,
        dashboard_id: dashboard.id,
        success: false,
      });
      toast.error("Couldn't delete canvas", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  // While renaming, swap the row for an inline editor that saves on Enter/blur.
  if (renaming) {
    return (
      <div className="flex w-full items-start gap-2 px-2 py-1">
        <span className="mt-px shrink-0">
          {iconForTemplate(dashboard.templateId)}
        </span>
        <HeaderTitleEditor
          key={renameAttempt}
          initialTitle={renameDraft ?? dashboard.name}
          onSubmit={onRename}
          onCancel={closeRename}
        />
      </div>
    );
  }

  return (
    <>
      <ContextMenu>
        <Tooltip>
          <ContextMenuTrigger
            render={
              <TooltipTrigger>
                <ChildRow
                  icon={iconForTemplate(dashboard.templateId)}
                  title={dashboard.name}
                  subtitle={`${relativeTime(dashboard.updatedAt)}`}
                  active={active}
                  onClick={() => {
                    track(ANALYTICS_EVENTS.DASHBOARD_ACTION, {
                      action_type: "open",
                      surface: "sidebar",
                      channel_id: channelId,
                      dashboard_id: dashboard.id,
                      template_id: dashboard.templateId,
                    });
                    navigate({
                      to: "/website/$channelId/dashboards/$dashboardId",
                      params: { channelId, dashboardId: dashboard.id },
                    });
                  }}
                />
              </TooltipTrigger>
            }
          />
          <TooltipContent side="right">{dashboard.name}</TooltipContent>
        </Tooltip>
        <ContextMenuContent>
          <ContextMenuItem
            disabled={isDeleting}
            onClick={() => setRenaming(true)}
          >
            <PencilSimpleIcon size={14} />
            Rename…
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            variant="destructive"
            disabled={isDeleting}
            onClick={() => setConfirmOpen(true)}
          >
            <TrashIcon size={14} />
            Delete…
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {generationTask ? (
        <CanvasGenerationTaskRow
          channelId={channelId}
          taskId={generationTask.id}
          task={generationTask}
          channelTaskId={generationChannelTaskId}
          channels={channels}
        />
      ) : null}

      <ConfirmDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete canvas</AlertDialogTitle>
            <AlertDialogDescription>
              "{dashboard.name}" will be permanently deleted. This can't be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose
              render={<Button variant="outline">Cancel</Button>}
            />
            <Button
              variant="primary"
              loading={isDeleting}
              onClick={() => void onDelete().then(() => setConfirmOpen(false))}
            >
              Delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </ConfirmDialog>
    </>
  );
}

// A filed task under a channel: the live status icon + title, with the shared
// right-click menu (File to… / Archive / Remove from channel).
function TaskRow({
  channelTaskId,
  channelId,
  taskId,
  task,
  title,
  active,
  onClick,
  channels,
}: {
  channelTaskId: string;
  channelId: string;
  taskId: string;
  task: Task | undefined;
  title: string;
  active: boolean;
  onClick: () => void;
  channels: Channel[];
}) {
  const taskData = useChannelTaskData(task);
  const session = useSessionForTask(taskId);
  const workspace = useWorkspace(taskId);
  const workspaceMode =
    workspace?.mode ??
    (taskData?.taskRunEnvironment === "cloud" ? "cloud" : undefined);
  const { prState, hasDiff } = useTaskPrStatus({
    id: taskId,
    cloudPrUrl: taskData?.cloudPrUrl ?? null,
    taskRunEnvironment: taskData?.taskRunEnvironment ?? null,
  });
  const icon = (
    <TaskStatusIcon
      taskData={taskData}
      prState={prState}
      hasDiff={hasDiff}
      workspaceMode={workspaceMode}
      size={16}
    />
  );

  // A short status word under the title (running / merged / …), mirroring the
  // task's live state. Repo-less local tasks (e.g. canvas generation) have no
  // backend run record, so `taskRunStatus` is undefined once the turn ends —
  // fall back to the live session so the row still shows a status line. A
  // session still mid-handshake ("connecting") is on its way to generating, so
  // treat it as running rather than letting it flash "completed".
  const status =
    taskData?.isGenerating === true
      ? "running"
      : (prState ??
        taskData?.taskRunStatus ??
        (session
          ? session.status === "error"
            ? "failed"
            : session.status === "connecting"
              ? "running"
              : "completed"
          : undefined));

  return (
    <TaskRowContextMenu
      channelId={channelId}
      taskId={taskId}
      channelTaskId={channelTaskId}
      title={title}
      channels={channels}
    >
      <ChildRow
        icon={icon}
        title={title}
        subtitle={status}
        active={active}
        onClick={onClick}
      />
    </TaskRowContextMenu>
  );
}

// One channel in the tree: a "# name" header that expands to its canvases and
// filed tasks. Children only load once the channel is open.
function ChannelSection({
  channel,
  channels,
}: {
  channel: Channel;
  channels: Channel[];
}) {
  const navigate = useNavigate();
  const openHomeCanvas = useOpenHomeCanvas();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { data: tasks } = useTasks();
  const archivedTaskIds = useArchivedTaskIds();
  const base = `/website/${channel.id}`;
  const isActive = pathname === base || pathname.startsWith(`${base}/`);
  // The header surface navigates to the channel index, so only highlight it
  // when that exact route is open (children carry their own active state).
  const isIndexActive = pathname === base;
  // Expansion is owned by the left icon trigger only. A deep link / fresh load
  // into a channel opens it once (initial state), but navigating the main row
  // afterward just selects the channel — it does not expand it.
  const [open, setOpen] = useState(isActive);
  // Lifted so the hover button group stays visible while the menu is open.
  const [menuOpen, setMenuOpen] = useState(false);
  // The "+" dropdown (New task / New canvas) and the canvas template picker it
  // can open. Both keep the hover actions pinned while active.
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [canvasOpen, setCanvasOpen] = useState(false);
  const canvasTemplates = useCanvasTemplates();
  const createAndOpenCanvas = useCreateAndOpenDashboard(channel.id);
  // Shared by the "..." dropdown and the right-click context menu so both offer
  // the same star / edit / rename / delete actions.
  const {
    actions,
    renameOpen,
    setRenameOpen,
    confirmDeleteOpen,
    setConfirmDeleteOpen,
    confirmDelete,
    isDeleting,
  } = useChannelActions(channel);
  // Only the first few tasks per channel show by default; "View more" reveals
  // another batch each click so a busy channel doesn't flood the sidebar.
  const [taskLimit, setTaskLimit] = useState(MAX_VISIBLE_TASKS_PER_CHANNEL);
  // Expansion is driven by the Collapsible's icon trigger; collapsing also
  // resets back to the first batch of tasks.
  const onOpenChange = (next: boolean) => {
    track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
      action_type: next ? "open_channel" : "collapse_channel",
      surface: "sidebar",
      channel_id: channel.id,
    });
    setOpen(next);
    if (!next) setTaskLimit(MAX_VISIBLE_TASKS_PER_CHANNEL);
  };

  // Lazy: a channel's canvases and filed tasks are only fetched once it's
  // expanded, so the tree doesn't fire one query per channel on mount.
  const { dashboards } = useDashboards(open ? channel.id : undefined);
  const { tasks: filedTasks } = useChannelTasks(open ? channel.id : undefined);
  // Warm both caches on hover/focus so the first expand is instant instead of
  // popping in after a cold fetch. No-ops once the data is fresh or loaded.
  const prefetchDashboards = usePrefetchDashboards();
  const prefetchChannelTasks = usePrefetchChannelTasks();
  const prefetchContents = () => {
    if (open) return;
    prefetchDashboards(channel.id);
    prefetchChannelTasks(channel.id);
  };
  // Tasks are private to each user. A task filed by someone else won't be in
  // `tasks` (it isn't shared with me), so hide it rather than rendering an
  // "Untitled task" placeholder. Also drop archived tasks.
  // Order by each task's own last-updated time (most recent first) so a
  // channel surfaces what's actively moving, rather than the order tasks were
  // filed. `filedTasks` arrives sorted by filing time; this re-sorts by the
  // task's `updated_at`. A single id→ms map keeps both the membership filter
  // and the sort O(1) per item; `|| 0` guards against a malformed date
  // (`Date.parse` → NaN) and a task that isn't loaded.
  const taskUpdatedAtMs = new Map(
    tasks?.map((t) => [t.id, Date.parse(t.updated_at) || 0]) ?? [],
  );
  // A canvas's generation task is shown nested under the canvas while it's
  // generating (and until the user has seen the result); don't also list it
  // flat below. Once it drops out of this set it reappears in the regular list
  // (if filed there). The currently-open task stays nested so it doesn't jump
  // out from under the canvas while still being viewed.
  const openTaskPrefix = `${base}/tasks/`;
  const openTaskId = pathname.startsWith(openTaskPrefix)
    ? pathname.slice(openTaskPrefix.length).split("/")[0]
    : undefined;
  const nestedGenerationTaskIds = useNestedGenerationTaskIds(
    dashboards,
    tasks,
    openTaskId,
  );
  const visibleFiledTasks = filedTasks
    .filter(
      ({ taskId }) =>
        !archivedTaskIds.has(taskId) &&
        taskUpdatedAtMs.has(taskId) &&
        !nestedGenerationTaskIds.has(taskId),
    )
    .sort(
      (a, b) =>
        (taskUpdatedAtMs.get(b.taskId) ?? 0) -
        (taskUpdatedAtMs.get(a.taskId) ?? 0),
    );
  const displayedFiledTasks = visibleFiledTasks.slice(0, taskLimit);
  const hiddenTaskCount = visibleFiledTasks.length - displayedFiledTasks.length;
  // Reveal one more batch, capped at the remaining count.
  const nextBatchCount = Math.min(
    hiddenTaskCount,
    MAX_VISIBLE_TASKS_PER_CHANNEL,
  );
  const hasChildren =
    dashboards.length > 0 ||
    displayedFiledTasks.length > 0 ||
    hiddenTaskCount > 0;

  return (
    <Box
      className="group/chan relative"
      onMouseEnter={prefetchContents}
      onFocus={prefetchContents}
    >
      <Collapsible variant="folder" open={open} onOpenChange={onOpenChange}>
        {/* Header row: the leading icon is the expand/collapse trigger (`#`
            swaps to a chevron on hover), and the rest of the row is a button
            that navigates into the channel index. */}
        <CollapsibleHeader>
          {/* Icon-only trigger — overlaid at the row's start edge. */}
          <CollapsibleTrigger
            iconOnly
            icon={<HashIcon size={14} />}
            aria-label={`Toggle ${channel.name}`}
          >
            Toggle {channel.name}
          </CollapsibleTrigger>
          {/* Full-row surface under the overlaid icon — ps-8 clears it so the
              name lines up with the "New" button above, and the whole row opens
              the channel index. Right-clicking it opens the same actions as the
              "..." menu. */}
          <ContextMenu>
            <ContextMenuTrigger
              render={
                <Button
                  variant="default"
                  size="default"
                  left
                  data-selected={isIndexActive || undefined}
                  onClick={() => {
                    track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
                      action_type: "nav_click",
                      surface: "sidebar",
                      channel_id: channel.id,
                    });
                    void openHomeCanvas(channel);
                  }}
                  className="w-full min-w-0 justify-start ps-8 data-selected:bg-fill-selected data-selected:text-gray-12"
                >
                  <span
                    className={cn(
                      "truncate font-medium text-[13px] text-gray-12 group-hover/chan:pr-8",
                      menuOpen && "pr-8",
                    )}
                  >
                    {channel.name}
                  </span>
                </Button>
              }
            />
            <ContextMenuContent>
              <ChannelActionItems actions={actions} kind="context" />
            </ContextMenuContent>
          </ContextMenu>
        </CollapsibleHeader>
        {/* Hover actions: the "+" dropdown (New task / New canvas) and the
            options menu. Stay visible while either is open. */}
        <div className="absolute top-1 right-1">
          <ButtonGroup>
            <DropdownMenu open={newMenuOpen} onOpenChange={setNewMenuOpen}>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <DropdownMenuTrigger
                      render={
                        <Button
                          variant="outline"
                          size="icon-xs"
                          aria-label={`New in ${channel.name}`}
                          className={cn(
                            "gap-1 transition-opacity group-hover:border-border",
                            menuOpen || newMenuOpen || canvasOpen
                              ? "opacity-100"
                              : "opacity-0 group-hover/chan:opacity-100",
                          )}
                        >
                          <PlusIcon size={12} weight="bold" />
                        </Button>
                      }
                    />
                  }
                />
                <TooltipContent side="top">New…</TooltipContent>
              </Tooltip>
              <DropdownMenuContent
                align="start"
                side="bottom"
                sideOffset={4}
                className="w-auto min-w-fit"
              >
                <DropdownMenuItem
                  onClick={() => {
                    track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
                      action_type: "new_task_open",
                      surface: "sidebar",
                      channel_id: channel.id,
                    });
                    navigate({
                      to: "/website/$channelId/new",
                      params: { channelId: channel.id },
                    });
                  }}
                >
                  <FileTextIcon size={14} />
                  New task
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    // No templates loaded yet: create with the default
                    // template, matching NewCanvasMenu's fallback. Otherwise
                    // open the template picker.
                    if (canvasTemplates.length === 0) {
                      trackAndCreateCanvas(
                        channel.id,
                        undefined,
                        "sidebar",
                        () => void createAndOpenCanvas(),
                      );
                    } else {
                      setCanvasOpen(true);
                    }
                  }}
                >
                  <ChartBarIcon size={14} />
                  New canvas
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <ChannelMenu
              channelName={channel.name}
              actions={actions}
              open={menuOpen}
              onOpenChange={setMenuOpen}
            />
          </ButtonGroup>
          <NewCanvasDialog
            channelId={channel.id}
            surface="sidebar"
            open={canvasOpen}
            onOpenChange={setCanvasOpen}
          />
        </div>
        {/* Children hang off a vertical guide line, like a tree. The folder
            variant's own inset is removed so the guide line controls indent. */}
        {hasChildren && (
          <CollapsibleContent className="px-0">
            <Flex
              direction="column"
              gap="px"
              className="mt-px ml-[11px] border-gray-6 border-l pl-2 empty:hidden"
            >
              {dashboards.map((d) => {
                const genTaskId = d.generationTaskId;
                const showGen =
                  !!genTaskId && nestedGenerationTaskIds.has(genTaskId);
                return (
                  <DashboardRow
                    key={d.id}
                    channelId={channel.id}
                    dashboard={d}
                    active={pathname === `${base}/dashboards/${d.id}`}
                    channels={channels}
                    generationTask={
                      showGen
                        ? tasks?.find((t) => t.id === genTaskId)
                        : undefined
                    }
                    generationChannelTaskId={
                      showGen
                        ? filedTasks.find((f) => f.taskId === genTaskId)?.id
                        : undefined
                    }
                  />
                );
              })}
              {displayedFiledTasks.map(({ id: channelTaskId, taskId }) => {
                const task = tasks?.find((t) => t.id === taskId);
                const title = task?.title || "Untitled task";
                return (
                  <TaskRow
                    key={channelTaskId}
                    channelTaskId={channelTaskId}
                    channelId={channel.id}
                    taskId={taskId}
                    task={task}
                    title={title}
                    active={pathname === `${base}/tasks/${taskId}`}
                    onClick={() =>
                      navigate({
                        to: "/website/$channelId/tasks/$taskId",
                        params: { channelId: channel.id, taskId },
                      })
                    }
                    channels={channels}
                  />
                );
              })}
              {hiddenTaskCount > 0 && (
                <Button
                  variant="default"
                  size="default"
                  onClick={() => {
                    track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
                      action_type: "view_more_tasks",
                      surface: "sidebar",
                      channel_id: channel.id,
                    });
                    setTaskLimit((n) => n + MAX_VISIBLE_TASKS_PER_CHANNEL);
                  }}
                  className="w-full min-w-0 justify-start gap-2 text-[13px] text-gray-10"
                >
                  <span className="inline-flex size-[14px] shrink-0 items-center justify-center">
                    <CaretDownIcon size={12} />
                  </span>
                  View {nextBatchCount} more
                </Button>
              )}
            </Flex>
          </CollapsibleContent>
        )}
      </Collapsible>
      {/* One modal for both the dropdown and context-menu "Rename" actions. */}
      <RenameChannelModal
        channel={channel}
        open={renameOpen}
        onOpenChange={setRenameOpen}
      />
      {/* Destructive confirm for "Delete channel" — spells out what's removed. */}
      <ConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
      >
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete #{channel.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the channel and can’t be undone.
              <ul className="list-disc ps-4">
                <li>
                  The channel and its{" "}
                  <span className="font-medium">CONTEXT.md</span> are deleted.
                </li>
                <li>
                  Every canvas saved in this channel is permanently deleted.
                </li>
                <li>
                  Filed tasks are removed from the channel, but the tasks
                  themselves are not deleted.
                </li>
              </ul>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose
              render={<Button variant="outline">Cancel</Button>}
            />
            <Button
              variant="primary"
              loading={isDeleting}
              onClick={() =>
                void confirmDelete().then((ok) => {
                  if (ok) setConfirmDeleteOpen(false);
                })
              }
            >
              Delete channel
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </ConfirmDialog>
    </Box>
  );
}

// The channel list — the Channels space sidebar body. Starred channels surface
// in their own section at the top so the ones you use most stay in reach; the
// rest sit under a "Channels" label with the "New" channel button.
export function ChannelsList() {
  const { channels, isLoading } = useChannels();
  const { starredRefToShortcutId } = useChannelStars();
  const [modalOpen, setModalOpen] = useState(false);

  const starred = channels.filter((c) => starredRefToShortcutId.has(c.path));
  const others = channels.filter((c) => !starredRefToShortcutId.has(c.path));

  // Fire CHANNELS_SPACE_VIEWED once per space mount, after channels first load
  // (so the counts are accurate). The sidebar stays mounted while navigating
  // between channels, so this naturally fires once per entry into the space.
  const viewedTrackedRef = useRef(false);
  useEffect(() => {
    if (isLoading || viewedTrackedRef.current) return;
    viewedTrackedRef.current = true;
    track(ANALYTICS_EVENTS.CHANNELS_SPACE_VIEWED, {
      channel_count: channels.length,
      starred_count: starred.length,
    });
  }, [isLoading, channels.length, starred.length]);

  return (
    // One shared provider groups every row tooltip so that once one shows,
    // moving to the next row reveals its tooltip instantly (no re-delay).
    <TooltipProvider delay={600}>
      <Flex direction="column" gap="px" className="px-2 pb-2">
        <Box className="py-1.5">
          <Separator className="bg-border" />
        </Box>

        {starred.length > 0 && (
          <>
            <Box>
              <MenuLabel className="flex items-center gap-2 uppercase">
                <StarIcon size={14} className="text-gray-9" />
                Starred
              </MenuLabel>
            </Box>
            <div className="pl-2">
              {starred.map((channel) => (
                <ChannelSection
                  key={channel.id}
                  channel={channel}
                  channels={channels}
                />
              ))}
            </div>
          </>
        )}

        <Box className={cn(starred.length > 0 && "mt-3")}>
          <MenuLabel className="group flex items-center justify-between uppercase">
            <span className="flex items-center gap-2">
              <HashIcon size={14} className="text-gray-9" />
              Channels
            </span>
            <Button
              variant="outline"
              size="icon-xs"
              onClick={() => setModalOpen(true)}
              className="-mr-1 group-hover:border-border"
            >
              <PlusIcon size={14} />
            </Button>
          </MenuLabel>
        </Box>

        {!isLoading && channels.length === 0 && (
          <Text size="1" className="px-2 text-gray-9">
            No channels yet. Create one to get started.
          </Text>
        )}

        <div className="pl-2">
          {others.map((channel) => (
            <ChannelSection
              key={channel.id}
              channel={channel}
              channels={channels}
            />
          ))}
        </div>
      </Flex>

      <CreateChannelModal open={modalOpen} onOpenChange={setModalOpen} />
    </TooltipProvider>
  );
}
