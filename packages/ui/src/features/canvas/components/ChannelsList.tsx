import {
  ArchiveIcon,
  CaretDownIcon,
  CaretRightIcon,
  CaretUpIcon,
  CodeIcon,
  DotsThreeIcon,
  FileIcon,
  FileTextIcon,
  FolderIcon,
  HashIcon,
  PencilSimpleIcon,
  PlusIcon,
  StarIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import {
  Badge,
  Button,
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
} from "@posthog/quill";
import type { Task } from "@posthog/shared/domain-types";
import { useArchivedTaskIds } from "@posthog/ui/features/archive/useArchivedTaskIds";
import { useArchiveTask } from "@posthog/ui/features/archive/useArchiveTask";
import { CreateChannelModal } from "@posthog/ui/features/canvas/components/CreateChannelModal";
import { RenameChannelModal } from "@posthog/ui/features/canvas/components/RenameChannelModal";
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
} from "@posthog/ui/features/canvas/hooks/useChannelTasks";
import { TaskIcon } from "@posthog/ui/features/sidebar/components/items/TaskIcon";
import { useTaskPrStatus } from "@posthog/ui/features/sidebar/useTaskPrStatus";
import { useTasks } from "@posthog/ui/features/tasks/useTasks";
import { useWorkspace } from "@posthog/ui/features/workspace/useWorkspace";
import { toast } from "@posthog/ui/primitives/toast";
import * as Collapsible from "@radix-ui/react-collapsible";
import { Box, Flex, IconButton, Text, Tooltip } from "@radix-ui/themes";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";
import { hostClient } from "../hostClient";

function NavButton({
  label,
  icon,
  active,
  count,
  onClick,
}: {
  label: string;
  icon?: ReactNode;
  active?: boolean;
  count?: number;
  onClick?: () => void;
}) {
  return (
    <Button
      variant="default"
      size="sm"
      data-selected={active || undefined}
      onClick={onClick}
      className="w-full min-w-0 justify-start gap-2 data-selected:bg-fill-selected data-selected:text-gray-12"
    >
      {icon}
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      {count != null && (
        <Badge variant="default" className="ml-auto shrink-0">
          {count}
        </Badge>
      )}
    </Button>
  );
}

// Hover-revealed "..." menu on a channel header: rename or delete the channel.
function ChannelMenu({ channel }: { channel: Channel }) {
  const [open, setOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { deleteChannel, isDeleting } = useChannelMutations();
  const { isStarred, toggleStar, removeStar } = useChannelStarToggle(channel);

  const onDelete = async () => {
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
      // If we're inside the channel being deleted, fall back to the index.
      if (pathname.startsWith(`/website/${channel.id}`)) {
        void navigate({ to: "/website" });
      }
    } catch (error) {
      toast.error("Couldn't delete channel", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <Box
      className={cn(
        "transition-opacity",
        open ? "opacity-100" : "opacity-0 group-hover/chan:opacity-100",
      )}
    >
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger
          render={
            <IconButton
              variant="ghost"
              color="gray"
              size="1"
              aria-label={`Options for ${channel.name}`}
            >
              <DotsThreeIcon size={14} weight="bold" />
            </IconButton>
          }
        />
        <DropdownMenuContent
          align="end"
          side="bottom"
          sideOffset={4}
          className="w-auto min-w-fit"
        >
          <DropdownMenuItem onClick={() => toggleStar()}>
            <StarIcon size={14} weight={isStarred ? "fill" : "regular"} />
            {isStarred ? "Unstar channel" : "Star channel"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() =>
              navigate({
                to: "/website/$channelId/context",
                params: { channelId: channel.id },
              })
            }
          >
            <FileTextIcon size={14} />
            Edit CONTEXT.md
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setRenameOpen(true)}>
            <PencilSimpleIcon size={14} />
            Rename channel
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            disabled={isDeleting}
            onClick={() => void onDelete()}
          >
            <TrashIcon size={14} />
            Delete channel
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <RenameChannelModal
        channel={channel}
        open={renameOpen}
        onOpenChange={setRenameOpen}
      />
    </Box>
  );
}

// Right-click "File to..." submenu on a task row. Files the task to another
// channel by creating an extra `task` FS row under that folder.
function TaskNavRow({
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
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { fileTask, unfileTask } = useChannelTaskMutations();
  const { archiveTask } = useArchiveTask();
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
  const icon = taskData ? (
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
      size={14}
    />
  ) : (
    <CodeIcon size={14} className="text-gray-9" />
  );

  const onFileTo = async (targetChannelId: string) => {
    try {
      await fileTask(targetChannelId, taskId, title);
    } catch (error) {
      toast.error("Couldn't file task", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const onArchive = async () => {
    try {
      await archiveTask({ taskId });
    } catch (error) {
      toast.error("Couldn't archive task", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const onRemove = async () => {
    try {
      await unfileTask(channelTaskId);
      if (pathname === `/website/${channelId}/tasks/${taskId}`) {
        void navigate({
          to: "/website/$channelId",
          params: { channelId },
        });
      }
    } catch (error) {
      toast.error("Couldn't remove task from channel", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <ContextMenu>
      <Tooltip content={title} delayDuration={600}>
        <ContextMenuTrigger
          render={
            <Box>
              <NavButton
                label={title}
                icon={icon}
                active={active}
                onClick={onClick}
              />
            </Box>
          }
        />
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
        <ContextMenuItem variant="destructive" onClick={() => void onRemove()}>
          <XIcon size={14} />
          Remove from channel
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function ChannelSection({
  channel,
  channels,
}: {
  channel: Channel;
  channels: Channel[];
}) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { data: tasks } = useTasks();
  const { tasks: filedTasks } = useChannelTasks(channel.id);
  const archivedTaskIds = useArchivedTaskIds();
  // Tasks are private to each user. A task filed by someone else won't be in
  // `tasks` (it isn't shared with me), so hide it rather than rendering an
  // "Untitled task" placeholder. Also drop archived tasks.
  const visibleFiledTasks = filedTasks.filter(
    ({ taskId }) =>
      !archivedTaskIds.has(taskId) && tasks?.some((t) => t.id === taskId),
  );
  const base = `/website/${channel.id}`;
  const isActive = pathname === base || pathname.startsWith(`${base}/`);
  // Channels start collapsed; expansion is session-only. Navigating into a
  // channel (sidebar, cmd-k, deep link) auto-expands it so the active channel
  // is always open, while leaving manual collapse/expand intact afterward.
  const [open, setOpen] = useState(isActive);
  useEffect(() => {
    if (isActive) setOpen(true);
  }, [isActive]);

  return (
    <Box className="group/chan relative">
      <Collapsible.Root open={open} onOpenChange={setOpen}>
        <Collapsible.Trigger asChild>
          <Button
            variant="default"
            size="sm"
            // Collapsible.Trigger sets aria-expanded, which the default Button
            // styles with a persistent highlight. Suppress it — an expanded
            // channel should only highlight on hover (or via its active child).
            className="aria-expanded:!bg-transparent hover:aria-expanded:!bg-fill-hover w-full justify-start gap-2 pr-16"
          >
            {/* `#` by default; swaps to the expand/collapse caret on hover. */}
            <span className="flex size-3.5 shrink-0 items-center justify-center text-gray-10">
              <HashIcon size={14} className="block group-hover/chan:hidden" />
              {open ? (
                <CaretDownIcon
                  size={12}
                  className="hidden group-hover/chan:block"
                />
              ) : (
                <CaretRightIcon
                  size={12}
                  className="hidden group-hover/chan:block"
                />
              )}
            </span>
            <span className="truncate font-medium">{channel.name}</span>
          </Button>
        </Collapsible.Trigger>
        <Collapsible.Content>
          <Flex direction="column" gap="1" pt="1" pl="3">
            <NavButton
              label="Canvases"
              icon={<FileIcon size={14} className="text-gray-9" />}
              active={
                pathname === base || pathname.startsWith(`${base}/dashboards`)
              }
              onClick={() =>
                navigate({
                  to: "/website/$channelId",
                  params: { channelId: channel.id },
                })
              }
            />
            {visibleFiledTasks.map(({ id: channelTaskId, taskId }) => {
              const task = tasks?.find((t) => t.id === taskId);
              const title = task?.title || "Untitled task";
              return (
                <TaskNavRow
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
          </Flex>
        </Collapsible.Content>
      </Collapsible.Root>
      <Flex gap="1" align="center" className="absolute top-1 right-1">
        <Box className="opacity-0 transition-opacity group-hover/chan:opacity-100">
          <Tooltip content="New task" side="top">
            <IconButton
              variant="ghost"
              color="gray"
              size="1"
              aria-label={`New task in ${channel.name}`}
              onClick={() =>
                navigate({
                  to: "/website/$channelId/new",
                  params: { channelId: channel.id },
                })
              }
            >
              <PlusIcon size={14} weight="bold" />
            </IconButton>
          </Tooltip>
        </Box>
        <ChannelMenu channel={channel} />
      </Flex>
    </Box>
  );
}

// A collapsible channel group with a leading icon that swaps to a caret on
// hover (Slack-style). Sections start expanded; collapse state is session-only.
function ChannelGroup({
  label,
  icon,
  isEmpty = false,
  emptyHint,
  className,
  headerAction,
  children,
}: {
  label: string;
  icon: ReactNode;
  isEmpty?: boolean;
  emptyHint?: ReactNode;
  className?: string;
  headerAction?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);

  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} className={className}>
      <Box className="group/grp relative">
        <Collapsible.Trigger asChild>
          <button
            type="button"
            className="flex w-full items-center gap-2 px-2 pt-1 text-left"
          >
            {/* Leading icon by default; swaps to the expand/collapse caret on hover. */}
            <span className="flex size-4 shrink-0 items-center justify-center text-gray-9">
              <span className="block group-hover/grp:hidden">{icon}</span>
              {open ? (
                <CaretUpIcon
                  size={12}
                  className="hidden group-hover/grp:block"
                />
              ) : (
                <CaretDownIcon
                  size={12}
                  className="hidden group-hover/grp:block"
                />
              )}
            </span>
            <Text weight="medium" className="text-gray-9 text-xs tracking-wide">
              {label}
            </Text>
          </button>
        </Collapsible.Trigger>
        {headerAction && (
          <Box className="absolute top-0.5 right-1 opacity-0 transition-opacity group-hover/grp:opacity-100">
            {headerAction}
          </Box>
        )}
      </Box>
      <Collapsible.Content>
        <Flex direction="column" gap="1" pt="1" pl="3">
          {isEmpty ? emptyHint : children}
        </Flex>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

// The channel list — the Channels space sidebar. Channels are server-backed;
// selecting one opens its dashboards under /website/$channelId. Starred
// channels are user-specific and surface in their own section at the top.
export function ChannelsList() {
  const { channels, isLoading } = useChannels();
  const { starredRefToShortcutId } = useChannelStars();
  const [modalOpen, setModalOpen] = useState(false);

  const starredChannels = channels.filter((c) =>
    starredRefToShortcutId.has(c.path),
  );
  const otherChannels = channels.filter(
    (c) => !starredRefToShortcutId.has(c.path),
  );

  return (
    <Flex direction="column" className="h-full min-h-0">
      <Flex
        direction="column"
        gap="1"
        className="min-h-0 flex-1 overflow-y-auto px-1 pt-1"
      >
        {!isLoading && channels.length === 0 && (
          <Text size="1" className="px-2 text-gray-9">
            No channels yet. Create one to get started.
          </Text>
        )}

        {channels.length > 0 && (
          <>
            <ChannelGroup
              label="Starred"
              icon={<StarIcon size={14} className="text-gray-9" />}
              isEmpty={starredChannels.length === 0}
              emptyHint={
                <Text
                  as="div"
                  size="1"
                  className="mx-1 rounded-md border border-gray-6 border-dashed px-2 py-1.5 text-[11px] text-gray-9 leading-snug"
                >
                  Star channels you use often to pin them here.
                </Text>
              }
            >
              {starredChannels.map((channel) => (
                <ChannelSection
                  key={channel.id}
                  channel={channel}
                  channels={channels}
                />
              ))}
            </ChannelGroup>

            {otherChannels.length > 0 && (
              <ChannelGroup
                label="Channels"
                icon={<HashIcon size={14} className="text-gray-9" />}
                className="mt-3"
                headerAction={
                  <Tooltip content="New channel" side="top">
                    <IconButton
                      variant="ghost"
                      color="gray"
                      size="1"
                      aria-label="New channel"
                      onClick={() => setModalOpen(true)}
                    >
                      <PlusIcon size={14} weight="bold" />
                    </IconButton>
                  </Tooltip>
                }
              >
                {otherChannels.map((channel) => (
                  <ChannelSection
                    key={channel.id}
                    channel={channel}
                    channels={channels}
                  />
                ))}
              </ChannelGroup>
            )}
          </>
        )}
      </Flex>

      {/* Pinned to the bottom of the channels nav. */}
      <Box className="shrink-0 border-gray-6 border-t p-2">
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-center"
          onClick={() => setModalOpen(true)}
        >
          <PlusIcon size={14} />
          New channel
        </Button>
      </Box>

      <CreateChannelModal open={modalOpen} onOpenChange={setModalOpen} />
    </Flex>
  );
}
