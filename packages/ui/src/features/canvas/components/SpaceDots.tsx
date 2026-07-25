import {
  HashIcon,
  PlusIcon,
  SidebarSimpleIcon,
  StarIcon,
  UserIcon,
} from "@phosphor-icons/react";
import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@posthog/quill";
import { CreateChannelModal } from "@posthog/ui/features/canvas/components/CreateChannelModal";
import { ensurePersonalChannel } from "@posthog/ui/features/canvas/ensurePersonalChannel";
import {
  useChannelStarMutations,
  useChannelStars,
} from "@posthog/ui/features/canvas/hooks/useChannelStars";
import {
  type Channel,
  useChannelMutations,
  useChannels,
} from "@posthog/ui/features/canvas/hooks/useChannels";
import { useSpaces } from "@posthog/ui/features/canvas/hooks/useSpaces";
import { PERSONAL_CHANNEL_NAME } from "@posthog/ui/features/canvas/hooks/useTaskChannels";
import { useIsChannelUnread } from "@posthog/ui/features/canvas/hooks/useUnreadChannels";
import { useSpaceStore } from "@posthog/ui/features/canvas/stores/spaceStore";
import { toast } from "@posthog/ui/primitives/toast";
import { navigateToCode } from "@posthog/ui/router/navigationBridge";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";

const RAIL_BUTTON_CLASS =
  "flex size-5 shrink-0 items-center justify-center rounded text-gray-10 transition-colors hover:bg-gray-3 hover:text-gray-12";

/**
 * The Arc-style space switcher pinned above the sidebar footer. The personal
 * "#me" space is always first; then one dot per space. The "#" opens a
 * browse-all-channels menu (pick one to open it as a space); the "+" adds a
 * space — star an existing channel or create a new one. Ctrl+Alt+←/→ cycles.
 */
export function SpaceDots() {
  const { spaces, currentChannelId, switchTo, cycle } = useSpaces();
  const { channels } = useChannels();
  const { createChannel } = useChannelMutations();
  const { starredRefToShortcutId } = useChannelStars();
  const { star } = useChannelStarMutations();
  const setCurrentChannel = useSpaceStore((s) => s.setCurrentChannel);
  const isUnread = useIsChannelUnread();
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey || !event.altKey) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        cycle(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        cycle(1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cycle]);

  const meChannel = channels.find((c) => c.name === PERSONAL_CHANNEL_NAME);
  const meActive = !!meChannel && meChannel.id === currentChannelId;
  const dotSpaces = spaces.filter((c) => c.name !== PERSONAL_CHANNEL_NAME);
  const browsable = channels
    .filter((c) => c.name !== PERSONAL_CHANNEL_NAME)
    .sort((a, b) => a.name.localeCompare(b.name));
  // Channels that aren't a space yet — what "+" offers to add.
  const addable = browsable.filter((c) => !spaces.some((s) => s.id === c.id));

  // Open (creating on first use) the personal space.
  const openPersonalSpace = () => {
    ensurePersonalChannel(channels, createChannel)
      .then((me) => switchTo(me))
      .catch((error: unknown) => {
        toast.error("Couldn't open your personal space", {
          description: error instanceof Error ? error.message : String(error),
        });
      });
  };

  // Adding a space stars the channel so its dot persists (spaces = starred).
  const addSpace = (channel: Channel) => {
    star(channel).catch((error: unknown) => {
      toast.error("Couldn't add space", {
        description: error instanceof Error ? error.message : String(error),
      });
    });
    switchTo(channel);
  };

  // Escape hatch back to the classic sidebar (channel list + nav, where the
  // Channels toggle lives). Client-side only — navigating to /website would
  // redirect into the first channel and immediately re-scope the sidebar.
  const showChannelList = () => {
    setCurrentChannel(null);
    navigateToCode();
  };

  return (
    <TooltipProvider delay={300}>
      <div className="flex shrink-0 items-center gap-1 px-3 py-1.5">
        {/* Browse all channels; picking one opens it as a space. */}
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger
              render={
                <DropdownMenuTrigger
                  render={
                    <button
                      type="button"
                      aria-label="All channels"
                      className={RAIL_BUTTON_CLASS}
                    >
                      <HashIcon size={12} />
                    </button>
                  }
                />
              }
            />
            <TooltipContent side="top">All channels</TooltipContent>
          </Tooltip>
          <DropdownMenuContent
            align="start"
            side="top"
            sideOffset={6}
            className="max-h-80 w-56 overflow-y-auto"
          >
            {browsable.length === 0 && (
              <DropdownMenuItem disabled>No channels yet</DropdownMenuItem>
            )}
            {browsable.map((channel) => (
              <DropdownMenuItem
                key={channel.id}
                onClick={() => switchTo(channel)}
              >
                <HashIcon size={14} className="text-gray-9" />
                <span className="min-w-0 flex-1 truncate">{channel.name}</span>
                {starredRefToShortcutId.has(channel.path) && (
                  <StarIcon size={12} weight="fill" className="text-amber-9" />
                )}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={showChannelList}>
              <SidebarSimpleIcon size={14} className="text-gray-9" />
              Show channel list
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* The personal space — always present, always first. */}
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label="# me (personal space)"
                onClick={openPersonalSpace}
                className={cn(
                  RAIL_BUTTON_CLASS,
                  meActive && "bg-gray-3 text-gray-12",
                )}
              >
                <UserIcon size={12} weight={meActive ? "fill" : "regular"} />
              </button>
            }
          />
          <TooltipContent side="top"># me</TooltipContent>
        </Tooltip>

        <div className="flex min-w-0 flex-1 items-center justify-center gap-1.5 overflow-hidden">
          {dotSpaces.map((channel) => {
            const active = channel.id === currentChannelId;
            return (
              <Tooltip key={channel.id}>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      aria-label={`# ${channel.name}`}
                      onClick={() => switchTo(channel)}
                      className="group flex size-4 shrink-0 items-center justify-center"
                    >
                      <motion.span
                        animate={{ scale: active ? 1.4 : 1 }}
                        transition={{
                          type: "spring",
                          stiffness: 500,
                          damping: 30,
                        }}
                        className={cn(
                          "block size-1.5 rounded-full transition-colors",
                          active
                            ? "bg-gray-12"
                            : isUnread(channel.name)
                              ? "bg-blue-9 group-hover:bg-blue-10"
                              : "bg-gray-7 group-hover:bg-gray-10",
                        )}
                      />
                    </button>
                  }
                />
                <TooltipContent side="top"># {channel.name}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>

        {/* Add a space: star an existing channel, or create a new one. */}
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger
              render={
                <DropdownMenuTrigger
                  render={
                    <button
                      type="button"
                      aria-label="New space"
                      className={RAIL_BUTTON_CLASS}
                    >
                      <PlusIcon size={12} weight="bold" />
                    </button>
                  }
                />
              }
            />
            <TooltipContent side="top">New space</TooltipContent>
          </Tooltip>
          <DropdownMenuContent
            align="end"
            side="top"
            sideOffset={6}
            className="max-h-80 w-56 overflow-y-auto"
          >
            {addable.map((channel) => (
              <DropdownMenuItem
                key={channel.id}
                onClick={() => addSpace(channel)}
              >
                <HashIcon size={14} className="text-gray-9" />
                <span className="min-w-0 flex-1 truncate">{channel.name}</span>
              </DropdownMenuItem>
            ))}
            {addable.length > 0 && <DropdownMenuSeparator />}
            <DropdownMenuItem onClick={() => setCreateOpen(true)}>
              <PlusIcon size={14} className="text-gray-9" />
              New channel…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <CreateChannelModal open={createOpen} onOpenChange={setCreateOpen} />
    </TooltipProvider>
  );
}
