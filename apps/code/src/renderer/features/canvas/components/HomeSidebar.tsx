import { CreateChannelModal } from "@features/canvas/components/CreateChannelModal";
import {
  type Channel,
  useChannelMutations,
  useChannels,
} from "@features/canvas/hooks/useChannels";
import { useAdoptOrphanDashboards } from "@features/canvas/hooks/useDashboards";
import {
  useChannelTaskIds,
  useChannelTasksStore,
} from "@features/canvas/stores/websiteTasksStore";
import { useTasks } from "@features/tasks/hooks/useTasks";
import { DotsThreeIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
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
import { Box, Flex, IconButton, Text } from "@radix-ui/themes";
import { toast } from "@renderer/utils/toast";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useState } from "react";

function NavButton({
  label,
  active,
  disabled,
  count,
  onClick,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  count?: number;
  onClick?: () => void;
}) {
  return (
    <Button
      variant="default"
      size="sm"
      data-selected={active || undefined}
      disabled={disabled}
      onClick={onClick}
      className="w-full justify-start data-selected:bg-fill-selected data-selected:text-gray-12"
    >
      {label}
      {count != null && (
        <Badge variant="default" className="ml-auto">
          {count}
        </Badge>
      )}
    </Button>
  );
}

// Hover-revealed "..." menu on a channel header: delete the channel.
function ChannelMenu({ channel }: { channel: Channel }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { deleteChannel, isDeleting } = useChannelMutations();
  const removeChannel = useChannelTasksStore((s) => s.removeChannel);

  const onDelete = async () => {
    try {
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
        <DropdownMenuContent align="end" side="bottom" sideOffset={4}>
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
              label="Dashboards"
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
            <NavButton
              label="New task"
              active={pathname === `${base}/new`}
              onClick={() =>
                navigate({
                  to: "/website/$channelId/new",
                  params: { channelId: channel.id },
                })
              }
            />
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
            {taskIds.length > 0 && (
              <Text size="1" className="px-2 pt-2 text-gray-9">
                Tasks
              </Text>
            )}
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
      <Box className="absolute top-1 right-1">
        <ChannelMenu channel={channel} />
      </Box>
    </Box>
  );
}

export function HomeSidebar() {
  const { channels, isLoading } = useChannels();
  const [modalOpen, setModalOpen] = useState(false);

  // Backfill dashboards saved before channel scoping into the first channel.
  useAdoptOrphanDashboards(channels[0]?.id);

  return (
    <Box
      className="h-full shrink-0 border-gray-6 border-r bg-gray-1"
      style={{ width: 240, minWidth: 240 }}
    >
      <Flex direction="column" gap="2" className="px-2 pt-10 pb-2">
        <Flex align="center" justify="between" className="px-1">
          <Text size="2" weight="bold" className="text-gray-12">
            Home
          </Text>
          <IconButton
            variant="ghost"
            color="gray"
            size="1"
            aria-label="Create channel"
            onClick={() => setModalOpen(true)}
          >
            <PlusIcon size={12} />
          </IconButton>
        </Flex>

        {!isLoading && channels.length === 0 && (
          <Text size="1" className="px-2 text-gray-9">
            No channels yet. Create one to get started.
          </Text>
        )}

        {channels.map((channel) => (
          <ChannelSection key={channel.id} channel={channel} />
        ))}
      </Flex>

      <CreateChannelModal open={modalOpen} onOpenChange={setModalOpen} />
    </Box>
  );
}
