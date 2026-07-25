import { HashIcon, PlusIcon, UserIcon, XIcon } from "@phosphor-icons/react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  cn,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@posthog/quill";
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
import { useSpaceEmojiStore } from "@posthog/ui/features/canvas/stores/spaceEmojiStore";
import { useSpaceStore } from "@posthog/ui/features/canvas/stores/spaceStore";
import { toast } from "@posthog/ui/primitives/toast";
import { useNavigate } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { useEffect } from "react";

const RAIL_BUTTON_CLASS =
  "flex size-5 shrink-0 items-center justify-center rounded text-gray-10 transition-colors hover:bg-gray-3 hover:text-gray-12";

// Curated emoji choices for a space's dot (Arc-style space icons).
const SPACE_EMOJIS = [
  "🦔",
  "🚀",
  "🔥",
  "⭐",
  "🎨",
  "📊",
  "🧪",
  "🔧",
  "📦",
  "🤖",
  "💬",
  "🧠",
  "📈",
  "🐛",
  "🎯",
  "⚡",
  "🌊",
  "📝",
  "🔒",
  "❤️",
] as const;

// One space in the dot row: an emoji (if set), the person glyph for "#me", or
// a plain dot. Right-click offers emoji selection and, for starred channels,
// removing the space.
function SpaceDot({
  channel,
  active,
  unread,
  onSelect,
}: {
  channel: Channel;
  active: boolean;
  unread: boolean;
  onSelect: () => void;
}) {
  const isMe = channel.name === PERSONAL_CHANNEL_NAME;
  const emoji = useSpaceEmojiStore((s) => s.emojiByChannelId[channel.id]);
  const setEmoji = useSpaceEmojiStore((s) => s.setEmoji);
  const { starredRefToShortcutId } = useChannelStars();
  const { unstar } = useChannelStarMutations();
  const shortcutId = starredRefToShortcutId.get(channel.path);

  const removeSpace = () => {
    if (!shortcutId) return;
    unstar(shortcutId).catch((error: unknown) => {
      toast.error("Couldn't remove space", {
        description: error instanceof Error ? error.message : String(error),
      });
    });
  };

  const glyph = emoji ? (
    <motion.span
      animate={{ scale: active ? 1.25 : 1 }}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
      className={cn(
        "block text-[11px] leading-none transition-opacity",
        active ? "opacity-100" : "opacity-60 group-hover:opacity-90",
      )}
    >
      {emoji}
    </motion.span>
  ) : isMe ? (
    <UserIcon
      size={12}
      weight={active ? "fill" : "regular"}
      className={cn(
        "transition-colors",
        active ? "text-gray-12" : "text-gray-9 group-hover:text-gray-11",
      )}
    />
  ) : (
    <motion.span
      animate={{ scale: active ? 1.4 : 1 }}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
      className={cn(
        "block size-1.5 rounded-full transition-colors",
        active
          ? "bg-gray-12"
          : unread
            ? "bg-blue-9 group-hover:bg-blue-10"
            : "bg-gray-7 group-hover:bg-gray-10",
      )}
    />
  );

  return (
    <ContextMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <ContextMenuTrigger
              render={
                <button
                  type="button"
                  aria-label={`# ${channel.name}`}
                  onClick={onSelect}
                  className="group flex size-4 shrink-0 items-center justify-center"
                >
                  {glyph}
                </button>
              }
            />
          }
        />
        <TooltipContent side="top"># {channel.name}</TooltipContent>
      </Tooltip>
      <ContextMenuContent className="w-48">
        {/* Emoji grid — plain buttons inside the menu, not menu items, so a
            pick doesn't need per-emoji rows. */}
        <div className="grid grid-cols-5 gap-0.5 p-1">
          {SPACE_EMOJIS.map((option) => (
            <button
              key={option}
              type="button"
              aria-label={`Set emoji ${option}`}
              onClick={() => setEmoji(channel.id, option)}
              className={cn(
                "flex size-7 items-center justify-center rounded text-[14px] transition-colors hover:bg-gray-3",
                emoji === option && "bg-gray-4",
              )}
            >
              {option}
            </button>
          ))}
        </div>
        {(emoji || (!isMe && shortcutId)) && <ContextMenuSeparator />}
        {emoji && (
          <ContextMenuItem onClick={() => setEmoji(channel.id, null)}>
            <XIcon size={14} />
            Remove emoji
          </ContextMenuItem>
        )}
        {!isMe && shortcutId && (
          <ContextMenuItem onClick={removeSpace}>
            <XIcon size={14} />
            Remove space
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

/**
 * The Arc-style space switcher pinned above the sidebar footer. "#me" is
 * always the first space in the row; added spaces append to the right. The
 * "#" toggles the sidebar body into the all-channels list; the "+" opens a
 * draft new space with its own temporary dot. Ctrl+Alt+←/→ and horizontal
 * swipes cycle spaces.
 */
export function SpaceDots() {
  const navigate = useNavigate();
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

  const hasMe = spaces.some((c) => c.name === PERSONAL_CHANNEL_NAME);
  const overrideOpen = browsing || draftSpace;

  // The "#" directory is a preview: while it's open the sidebar lists every
  // channel and clicking one just shows its activity in the main view. Closing
  // it returns to the current space (or the landing) so the preview leaves no
  // trace — no space scoped, nothing pinned.
  const toggleBrowsing = () => {
    if (!browsing) {
      setBrowsing(true);
      return;
    }
    const current = channels.find((c) => c.id === currentChannelId);
    if (current) {
      switchTo(current);
    } else {
      setBrowsing(false);
      void navigate({ to: "/website" });
    }
  };

  // Open (creating on first use) the personal space — only needed while the
  // "#me" channel doesn't exist yet; afterwards it's a regular dot.
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
                onClick={toggleBrowsing}
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

        <div className="flex min-w-0 flex-1 items-center justify-center gap-1.5 overflow-hidden">
          {/* "#me" not provisioned yet: show its slot anyway, first. */}
          {!hasMe && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label="# me (personal space)"
                    onClick={openPersonalSpace}
                    className="group flex size-4 shrink-0 items-center justify-center"
                  >
                    <UserIcon
                      size={12}
                      className="text-gray-9 transition-colors group-hover:text-gray-11"
                    />
                  </button>
                }
              />
              <TooltipContent side="top"># me</TooltipContent>
            </Tooltip>
          )}
          {spaces.map((channel) => (
            <SpaceDot
              key={channel.id}
              channel={channel}
              active={channel.id === currentChannelId && !overrideOpen}
              unread={isUnread(channel.name)}
              onSelect={() => switchTo(channel)}
            />
          ))}
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
