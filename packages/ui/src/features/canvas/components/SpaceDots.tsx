import { HashIcon, PlusIcon } from "@phosphor-icons/react";
import {
  cn,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@posthog/quill";
import { CreateChannelModal } from "@posthog/ui/features/canvas/components/CreateChannelModal";
import { useSpaces } from "@posthog/ui/features/canvas/hooks/useSpaces";
import { useIsChannelUnread } from "@posthog/ui/features/canvas/hooks/useUnreadChannels";
import { useSpaceStore } from "@posthog/ui/features/canvas/stores/spaceStore";
import { useNavigate } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";

/**
 * The Arc-style space switcher pinned above the sidebar footer: one dot per
 * space (starred channel), a "#" escape hatch to the all-channels landing, and
 * a "+" that creates a new channel (= a new space). Ctrl+Alt+←/→ cycles.
 */
export function SpaceDots() {
  const navigate = useNavigate();
  const { spaces, currentChannelId, switchTo, cycle } = useSpaces();
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

  const goToLanding = () => {
    setCurrentChannel(null);
    void navigate({ to: "/website" });
  };

  return (
    <TooltipProvider delay={300}>
      <div className="flex shrink-0 items-center gap-1 px-3 py-1.5">
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label="All channels"
                onClick={goToLanding}
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded text-gray-10 transition-colors hover:bg-gray-3 hover:text-gray-12",
                  currentChannelId === null && "text-gray-12",
                )}
              >
                <HashIcon size={12} />
              </button>
            }
          />
          <TooltipContent side="top">All channels</TooltipContent>
        </Tooltip>

        <div className="flex min-w-0 flex-1 items-center justify-center gap-1.5 overflow-hidden">
          {spaces.map((channel) => {
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

        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label="New space"
                onClick={() => setCreateOpen(true)}
                className="flex size-5 shrink-0 items-center justify-center rounded text-gray-10 transition-colors hover:bg-gray-3 hover:text-gray-12"
              >
                <PlusIcon size={12} weight="bold" />
              </button>
            }
          />
          <TooltipContent side="top">New space (channel)</TooltipContent>
        </Tooltip>
      </div>
      <CreateChannelModal open={createOpen} onOpenChange={setCreateOpen} />
    </TooltipProvider>
  );
}
