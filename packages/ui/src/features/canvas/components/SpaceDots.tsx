import { HashIcon, PlusIcon, UserIcon } from "@phosphor-icons/react";
import {
  cn,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@posthog/quill";
import { ensurePersonalChannel } from "@posthog/ui/features/canvas/ensurePersonalChannel";
import {
  useChannelMutations,
  useChannels,
} from "@posthog/ui/features/canvas/hooks/useChannels";
import { useSpaces } from "@posthog/ui/features/canvas/hooks/useSpaces";
import { PERSONAL_CHANNEL_NAME } from "@posthog/ui/features/canvas/hooks/useTaskChannels";
import { useIsChannelUnread } from "@posthog/ui/features/canvas/hooks/useUnreadChannels";
import { useSpaceStore } from "@posthog/ui/features/canvas/stores/spaceStore";
import { toast } from "@posthog/ui/primitives/toast";
import { motion } from "framer-motion";
import { useEffect } from "react";

const RAIL_BUTTON_CLASS =
  "flex size-5 shrink-0 items-center justify-center rounded text-gray-10 transition-colors hover:bg-gray-3 hover:text-gray-12";

/**
 * The Arc-style space switcher pinned above the sidebar footer. The personal
 * "#me" space is always first; then one dot per space. The "#" toggles the
 * sidebar body into the all-channels list; the "+" opens a draft new space
 * (choose a channel or create one) with its own temporary dot. Ctrl+Alt+←/→
 * cycles spaces.
 */
export function SpaceDots() {
  const { spaces, currentChannelId, switchTo, cycle } = useSpaces();
  const { channels } = useChannels();
  const { createChannel } = useChannelMutations();
  const browsing = useSpaceStore((s) => s.browsing);
  const draftSpace = useSpaceStore((s) => s.draftSpace);
  const setBrowsing = useSpaceStore((s) => s.setBrowsing);
  const setDraftSpace = useSpaceStore((s) => s.setDraftSpace);
  const isUnread = useIsChannelUnread();

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
  const meActive =
    !!meChannel &&
    meChannel.id === currentChannelId &&
    !browsing &&
    !draftSpace;
  const dotSpaces = spaces.filter((c) => c.name !== PERSONAL_CHANNEL_NAME);

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

  return (
    <TooltipProvider delay={300}>
      <div className="flex shrink-0 items-center gap-1 px-3 py-1.5">
        {/* Toggle the sidebar body into the all-channels list (in place — no
            popover, no navigation). */}
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label="All channels"
                aria-pressed={browsing}
                onClick={() => setBrowsing(!browsing)}
                className={cn(
                  RAIL_BUTTON_CLASS,
                  browsing && "bg-gray-3 text-gray-12",
                )}
              >
                <HashIcon size={12} />
              </button>
            }
          />
          <TooltipContent side="top">All channels</TooltipContent>
        </Tooltip>

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
            const active =
              channel.id === currentChannelId && !browsing && !draftSpace;
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
          {/* The draft space's temporary dot — a hollow placeholder until a
              channel is chosen or created. */}
          {draftSpace && (
            <motion.span
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="block size-2 shrink-0 rounded-full border border-gray-10 border-dashed"
            />
          )}
        </div>

        {/* Open a draft new space (Arc-style): its dot appears immediately;
            the sidebar body becomes the choose-or-create view. */}
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label="New space"
                aria-pressed={draftSpace}
                onClick={() => setDraftSpace(!draftSpace)}
                className={cn(
                  RAIL_BUTTON_CLASS,
                  draftSpace && "bg-gray-3 text-gray-12",
                )}
              >
                <PlusIcon size={12} weight="bold" />
              </button>
            }
          />
          <TooltipContent side="top">New space</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
