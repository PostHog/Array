import { Popover as BasePopover } from "@base-ui/react/popover";
import { CaretUpDownIcon, PlusIcon, StarIcon } from "@phosphor-icons/react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  cn,
  Input,
  Kbd,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Separator,
  Skeleton,
} from "@posthog/quill";
import { ANALYTICS_EVENTS } from "@posthog/shared/analytics-events";
import { CreateChannelModal } from "@posthog/ui/features/canvas/components/CreateChannelModal";
import { channelGlyph } from "@posthog/ui/features/canvas/components/channelGlyph";
import { useChannelStarToggle } from "@posthog/ui/features/canvas/hooks/useChannelStars";
import {
  type Channel,
  useChannels,
} from "@posthog/ui/features/canvas/hooks/useChannels";
import { useStarredChannelSlots } from "@posthog/ui/features/canvas/hooks/useStarredChannelSlots";
import { PERSONAL_CHANNEL_NAME } from "@posthog/ui/features/canvas/hooks/useTaskChannels";
import { useCurrentChannelStore } from "@posthog/ui/features/canvas/stores/currentChannelStore";
import { formatHotkey } from "@posthog/ui/features/command/keyboard-shortcuts";
import { navigateToChannel } from "@posthog/ui/router/navigationBridge";
import { track } from "@posthog/ui/shell/analytics";
import { useState } from "react";

// Clears the row's 8px `mx-2` inset plus an 8px gap, so the panel lands past
// the sidebar edge rather than over it.
const POPOVER_SIDE_OFFSET = 16;

function SwitcherRow({
  channel,
  active,
  onPick,
  hotkeySlot,
}: {
  channel: Channel;
  active: boolean;
  onPick: () => void;
  hotkeySlot?: number;
}) {
  const isMe = channel.name === PERSONAL_CHANNEL_NAME;
  const { isStarred, toggleStar } = useChannelStarToggle(channel);

  const trackedToggleStar = () => {
    track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
      action_type: isStarred ? "unstar" : "star",
      surface: "sidebar",
      channel_id: channel.id,
    });
    toggleStar();
  };

  const row = (
    <div
      className={cn(
        "group flex items-center rounded-md transition-colors hover:bg-fill-hover",
        active && "bg-fill-selected",
      )}
    >
      <button
        type="button"
        onClick={onPick}
        className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1 text-left text-[13px]"
      >
        <span className="flex w-4 shrink-0 items-center justify-center">
          {channelGlyph(channel.name, {
            size: 14,
            className: "text-muted-foreground",
          })}
        </span>
        <span className="min-w-0 flex-1 truncate text-foreground">
          {channel.name}
        </span>
        {hotkeySlot != null && (
          <Kbd className="shrink-0">{formatHotkey(`mod+${hotkeySlot}`)}</Kbd>
        )}
      </button>
      {isMe ? (
        // #me is permanently pinned, so its star is inert — but the slot
        // still has to be filled to keep the rows aligned.
        <span
          aria-hidden
          className="mr-1 flex size-5 shrink-0 items-center justify-center text-muted-foreground opacity-40"
        >
          <StarIcon size={13} weight="fill" />
        </span>
      ) : (
        <button
          type="button"
          aria-label={isStarred ? "Unstar channel" : "Star channel"}
          onClick={trackedToggleStar}
          className={cn(
            "mr-1 flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground",
            !isStarred && "opacity-0 group-hover:opacity-100",
          )}
        >
          <StarIcon size={13} weight={isStarred ? "fill" : "regular"} />
        </button>
      )}
    </div>
  );

  if (isMe) return row;
  return (
    <ContextMenu>
      <ContextMenuTrigger render={row} />
      <ContextMenuContent>
        <ContextMenuItem onClick={trackedToggleStar}>
          <StarIcon size={14} weight={isStarred ? "fill" : "regular"} />
          {isStarred ? "Unstar channel" : "Star channel"}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

// An overlay rather than a sibling: a sibling would shrink the trigger, which
// the popover anchors to (see POPOVER_SIDE_OFFSET).
function TriggerStar({ channel }: { channel: Channel }) {
  const { isStarred, toggleStar } = useChannelStarToggle(channel);
  return (
    <button
      type="button"
      aria-label={isStarred ? "Unstar channel" : "Star channel"}
      onClick={() => {
        track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
          action_type: isStarred ? "unstar" : "star",
          surface: "sidebar",
          channel_id: channel.id,
        });
        toggleStar();
      }}
      // Parks in the trigger's reserved well: 8px padding + 12px caret + 6px
      // gap = 26px from the right edge.
      className="-translate-y-1/2 absolute top-1/2 right-[26px] flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-fill-hover hover:text-foreground"
    >
      <StarIcon size={14} weight={isStarred ? "fill" : "regular"} />
    </button>
  );
}

/**
 * The channel header as a switcher: clicking the "# channel" title opens a
 * searchable popover — "#me" first, then starred channels, then the rest.
 */
export function ChannelSwitcher({ channelId }: { channelId: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const { channels, isLoading: isLoadingChannels } = useChannels();
  const setCurrentChannel = useCurrentChannelStore((s) => s.setCurrentChannel);
  const current = channels.find((c) => c.id === channelId);
  // ChannelHotkeys owns the keys these slots describe; sharing the derivation
  // keeps the advertised key and the key that fires in agreement.
  const { slots, rest, slotFor } = useStarredChannelSlots();

  const normalizedQuery = query.trim().toLowerCase();
  const matches = (c: Channel) =>
    !normalizedQuery || c.name.toLowerCase().includes(normalizedQuery);
  const topFiltered = slots.filter(matches);
  const restFiltered = rest.filter(matches);

  const pick = (channel: Channel) => {
    setOpen(false);
    setQuery("");
    setCurrentChannel(channel.id);
    navigateToChannel(channel.id);
    track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
      action_type: "open_channel",
      surface: "sidebar",
      channel_id: channel.id,
    });
  };

  const showStar = current != null && current.name !== PERSONAL_CHANNEL_NAME;

  return (
    <div className="relative mx-2 mt-2">
      <Popover open={open} onOpenChange={setOpen}>
        {/* Portaled because ResizableSidebar's transform makes the sidebar a
            containing block, which would clip a fixed overlay; z-40 keeps it
            under the popup's z-50. */}
        <BasePopover.Portal>
          <BasePopover.Backdrop className="fixed inset-0 z-40 bg-blackA-4 opacity-100 transition-opacity duration-150 ease-out data-ending-style:opacity-0 data-starting-style:opacity-0 motion-reduce:transition-none dark:bg-blackA-7" />
        </BasePopover.Portal>
        <PopoverTrigger
          render={
            <button
              type="button"
              aria-label="Switch channel"
              // Fixed height with an unconditional star well: sized off its
              // contents, a starrable channel ran 4px taller than #me and
              // everything below shifted on switch.
              className="flex h-8 w-full items-center gap-1.5 rounded-md border border-border px-2 text-left transition-colors hover:bg-fill-hover aria-expanded:bg-fill-selected"
            >
              <span className="flex w-4 shrink-0 items-center justify-center">
                {channelGlyph(current?.name, {
                  size: 14,
                  className: "text-muted-foreground",
                })}
              </span>
              <span className="min-w-0 flex-1 truncate font-semibold text-[13px] text-foreground">
                {current ? (
                  current.name
                ) : isLoadingChannels ? (
                  // A placeholder word here would read as a real channel named
                  // "channel"; a skeleton says "still loading" honestly.
                  <Skeleton className="h-3.5 w-24" />
                ) : (
                  "Unavailable"
                )}
              </span>
              <span aria-hidden className="size-6 shrink-0" />
              <CaretUpDownIcon
                size={12}
                className="shrink-0 text-muted-foreground"
              />
            </button>
          }
        />
        <PopoverContent
          align="start"
          side="right"
          sideOffset={POPOVER_SIDE_OFFSET}
          // quill sets gap/padding/width/shadow from unlayered CSS that beats
          // plain utilities, hence the `!` overrides.
          className="w-64! gap-0 p-1! shadow-2xl!"
        >
          <div className="p-1">
            <Input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search channels…"
              aria-label="Search channels"
              className="h-7 text-[13px]"
            />
          </div>
          <div className="scroll-mask-4 max-h-72 overflow-y-auto">
            {topFiltered.map((channel) => (
              <SwitcherRow
                key={channel.id}
                channel={channel}
                active={channel.id === channelId}
                onPick={() => pick(channel)}
                hotkeySlot={slotFor(channel)}
              />
            ))}
            {topFiltered.length > 0 && restFiltered.length > 0 && (
              <Separator className="-mx-1 my-1" />
            )}
            {restFiltered.map((channel) => (
              <SwitcherRow
                key={channel.id}
                channel={channel}
                active={channel.id === channelId}
                onPick={() => pick(channel)}
              />
            ))}
            {topFiltered.length === 0 && restFiltered.length === 0 && (
              <p className="px-2 py-2 text-[12px] text-muted-foreground">
                No channels match "{query.trim()}".
              </p>
            )}
          </div>
          <Separator className="-mx-1 my-1" />
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setCreateOpen(true);
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[13px] text-muted-foreground transition-colors hover:bg-fill-hover"
          >
            <span className="flex w-4 shrink-0 items-center justify-center">
              <PlusIcon size={14} />
            </span>
            New channel…
          </button>
        </PopoverContent>
      </Popover>
      {showStar && current && <TriggerStar channel={current} />}
      {/* Inert star for #me, so the trigger reads the same on every channel. */}
      {current && !showStar && (
        <span
          aria-hidden
          className="-translate-y-1/2 pointer-events-none absolute top-1/2 right-[26px] flex size-6 items-center justify-center text-muted-foreground opacity-40"
        >
          <StarIcon size={14} weight="fill" />
        </span>
      )}
      <CreateChannelModal open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
