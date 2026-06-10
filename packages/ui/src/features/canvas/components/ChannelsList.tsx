import {
  CodeIcon,
  DotsThreeIcon,
  FileIcon,
  FolderIcon,
  PencilSimpleIcon,
  PlusIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import {
  Badge,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
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
  DropdownMenuTrigger,
} from "@posthog/quill";
import type { Task } from "@posthog/shared/domain-types";
import { CreateChannelModal } from "@posthog/ui/features/canvas/components/CreateChannelModal";
import { RenameChannelModal } from "@posthog/ui/features/canvas/components/RenameChannelModal";
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
import { Box, Flex, IconButton, Text, Tooltip } from "@radix-ui/themes";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
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
      className="w-full justify-start gap-2 data-selected:bg-fill-selected data-selected:text-gray-12"
    >
      {icon}
      {label}
      {count != null && (
        <Badge variant="default" className="ml-auto">
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
  const base = `/website/${channel.id}`;

  return (
    <Box className="group/chan relative">
      <Collapsible variant="folder" defaultOpen>
        <CollapsibleTrigger>{channel.name}</CollapsibleTrigger>
        <CollapsibleContent>
          <Flex direction="column" gap="1" pt="1" pl="3">
            <NavButton
              label="Dashboards"
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
            {filedTasks.map(({ id: channelTaskId, taskId }) => {
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
            <NavButton
              label="Settings"
              active={pathname.startsWith(`${base}/settings`)}
              onClick={() =>
                navigate({
                  to: "/website/$channelId/settings",
                  params: { channelId: channel.id },
                })
              }
            />
          </Flex>
        </CollapsibleContent>
      </Collapsible>
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

// The channel list — the Channels space sidebar. Channels are server-backed;
// selecting one opens its dashboards under /website/$channelId.
export function ChannelsList() {
  const { channels, isLoading } = useChannels();
  const [modalOpen, setModalOpen] = useState(false);

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

        {channels.map((channel) => (
          <ChannelSection
            key={channel.id}
            channel={channel}
            channels={channels}
          />
        ))}
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
