import {
  CheckCircleIcon,
  CircleDashedIcon,
  CircleIcon,
  DotsThreeIcon,
  PencilSimpleIcon,
  PlusIcon,
  RecordIcon,
  TrashIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import {
  Badge,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@posthog/quill";
import { CreateChannelModal } from "@posthog/ui/features/canvas/components/CreateChannelModal";
import { RenameChannelModal } from "@posthog/ui/features/canvas/components/RenameChannelModal";
import {
  type Channel,
  useChannelMutations,
  useChannels,
} from "@posthog/ui/features/canvas/hooks/useChannels";
import {
  useChannelTaskIds,
  useChannelTasksStore,
} from "@posthog/ui/features/canvas/stores/websiteTasksStore";
import { useTasks } from "@posthog/ui/features/tasks/useTasks";
import { toast } from "@posthog/ui/primitives/toast";
import { Box, Flex, IconButton, Text } from "@radix-ui/themes";
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

// Dummy task-status filters (no behaviour yet) for the channel's Tasks group.
const SESSION_STATUSES: { label: string; icon: ReactNode }[] = [
  {
    label: "Backlog",
    icon: <CircleDashedIcon size={14} className="text-gray-9" />,
  },
  { label: "Todo", icon: <CircleIcon size={14} className="text-gray-9" /> },
  {
    label: "Needs Review",
    icon: <RecordIcon size={14} weight="fill" className="text-orange-9" />,
  },
  {
    label: "Done",
    icon: <CheckCircleIcon size={14} weight="fill" className="text-violet-9" />,
  },
  {
    label: "Cancelled",
    icon: <XCircleIcon size={14} weight="fill" className="text-gray-9" />,
  },
];

// Hover-revealed "..." menu on a channel header: rename or delete the channel.
function ChannelMenu({ channel }: { channel: Channel }) {
  const [open, setOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { deleteChannel, isDeleting } = useChannelMutations();
  const removeChannel = useChannelTasksStore((s) => s.removeChannel);

  const onDelete = async () => {
    try {
      // Delete the channel's dashboards first: they're separate desktop-FS rows
      // (type "dashboard"), and the folder delete may not cascade our custom
      // type, which would orphan them. Best-effort — a failed child shouldn't
      // block removing the channel.
      const dashboards = await hostClient().dashboards.list.query({
        channelId: channel.id,
      });
      await Promise.allSettled(
        dashboards.map((d) =>
          hostClient().dashboards.delete.mutate({ id: d.id }),
        ),
      );

      await deleteChannel(channel.id);
      removeChannel(channel.id);
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

function ChannelSection({ channel }: { channel: Channel }) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { data: tasks } = useTasks();
  const taskIds = useChannelTaskIds(channel.id);
  const base = `/website/${channel.id}`;

  return (
    <Box className="group/chan relative">
      <Collapsible variant="folder" defaultOpen>
        <CollapsibleTrigger>{channel.name}</CollapsibleTrigger>
        <CollapsibleContent>
          <Flex direction="column" gap="1" pt="1" pl="3">
            <NavButton
              label="Canvases"
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
            <Collapsible variant="folder" defaultOpen>
              <CollapsibleTrigger>Tasks</CollapsibleTrigger>
              <CollapsibleContent>
                <Flex direction="column" gap="1" pt="1" pl="3">
                  <NavButton
                    label="New task"
                    icon={<PlusIcon size={14} className="text-gray-9" />}
                    active={pathname === `${base}/new`}
                    onClick={() =>
                      navigate({
                        to: "/website/$channelId/new",
                        params: { channelId: channel.id },
                      })
                    }
                  />
                  {SESSION_STATUSES.map((status) => (
                    <NavButton
                      key={status.label}
                      label={status.label}
                      icon={status.icon}
                    />
                  ))}
                  {taskIds.map((taskId) => {
                    const title = tasks?.find((t) => t.id === taskId)?.title;
                    return (
                      <NavButton
                        key={taskId}
                        label={title || "Untitled task"}
                        active={pathname === `${base}/tasks/${taskId}`}
                        onClick={() =>
                          navigate({
                            to: "/website/$channelId/tasks/$taskId",
                            params: { channelId: channel.id, taskId },
                          })
                        }
                      />
                    );
                  })}
                </Flex>
              </CollapsibleContent>
            </Collapsible>
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
      <Box className="absolute top-1 right-1">
        <ChannelMenu channel={channel} />
      </Box>
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
          <ChannelSection key={channel.id} channel={channel} />
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
