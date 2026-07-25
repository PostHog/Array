import {
  CaretUpDownIcon,
  HashIcon,
  PlusIcon,
  StarIcon,
} from "@phosphor-icons/react";
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
} from "@posthog/quill";
import { ANALYTICS_EVENTS } from "@posthog/shared/analytics-events";
import { CreateChannelModal } from "@posthog/ui/features/canvas/components/CreateChannelModal";
import {
  useChannelStars,
  useChannelStarToggle,
} from "@posthog/ui/features/canvas/hooks/useChannelStars";
import {
  type Channel,
  useChannels,
} from "@posthog/ui/features/canvas/hooks/useChannels";
import { PERSONAL_CHANNEL_NAME } from "@posthog/ui/features/canvas/hooks/useTaskChannels";
import { useCurrentChannelStore } from "@posthog/ui/features/canvas/stores/currentChannelStore";
import {
  formatHotkey,
  SHORTCUTS,
} from "@posthog/ui/features/command/keyboard-shortcuts";
import { navigateToChannel } from "@posthog/ui/router/navigationBridge";
import { track } from "@posthog/ui/shell/analytics";
import { useMemo, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";

// mod+0 jumps to #me; mod+1..9 jump to the first nine starred channels
// (see SWITCH_STARRED_CHANNEL).
const STARRED_HOTKEY_SLOTS = 9;

// One channel in the switcher; right-click stars/unstars it. #me and the first
// nine starred channels show their mod+N hotkey.
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

  const row = (
    <button
      type="button"
      onClick={onPick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[13px] transition-colors hover:bg-gray-3",
        active && "bg-fill-selected",
      )}
    >
      <span className="flex w-4 shrink-0 items-center justify-center">
        <HashIcon size={14} className="text-gray-10" />
      </span>
      <span className="min-w-0 flex-1 truncate text-gray-12">
        {channel.name}
      </span>
      {hotkeySlot != null && (
        <Kbd className="shrink-0">{formatHotkey(`mod+${hotkeySlot}`)}</Kbd>
      )}
    </button>
  );

  if (isMe) return row;
  return (
    <ContextMenu>
      <ContextMenuTrigger render={row} />
      <ContextMenuContent>
        <ContextMenuItem onClick={toggleStar}>
          <StarIcon size={14} weight={isStarred ? "fill" : "regular"} />
          {isStarred ? "Unstar channel" : "Star channel"}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
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
  const { channels } = useChannels();
  const { starredRefToShortcutId } = useChannelStars();
  const setCurrentChannel = useCurrentChannelStore((s) => s.setCurrentChannel);
  const current = channels.find((c) => c.id === channelId);

  const { top, rest, me, starred } = useMemo(() => {
    const me = channels.find((c) => c.name === PERSONAL_CHANNEL_NAME) ?? null;
    const byPath = new Map(channels.map((c) => [c.path, c]));
    const starred: Channel[] = [];
    for (const ref of starredRefToShortcutId.keys()) {
      const channel = byPath.get(ref);
      if (channel && channel.name !== PERSONAL_CHANNEL_NAME) {
        starred.push(channel);
      }
    }
    const top = me ? [me, ...starred] : starred;
    const seen = new Set(top.map((c) => c.id));
    const rest = channels
      .filter((c) => !seen.has(c.id))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { top, rest, me, starred };
  }, [channels, starredRefToShortcutId]);

  const normalizedQuery = query.trim().toLowerCase();
  const matches = (c: Channel) =>
    !normalizedQuery || c.name.toLowerCase().includes(normalizedQuery);
  const topFiltered = top.filter(matches);
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

  // mod+0 → #me, mod+1..9 → the Nth starred channel. Same ctrl guard as
  // SWITCH_TASK: plain ctrl+N belongs to tab switching.
  useHotkeys(
    SHORTCUTS.SWITCH_STARRED_CHANNEL,
    (event, handler) => {
      if (event.ctrlKey && !event.metaKey) return;
      const slot = Number.parseInt(handler.keys?.[0] ?? "", 10);
      if (Number.isNaN(slot)) return;
      const channel = slot === 0 ? me : starred[slot - 1];
      if (channel && slot <= STARRED_HOTKEY_SLOTS) pick(channel);
    },
    {
      enableOnFormTags: true,
      enableOnContentEditable: true,
      preventDefault: true,
    },
    [me, starred, pick],
  );

  const hotkeySlotFor = (channel: Channel) => {
    if (me && channel.id === me.id) return 0;
    const index = starred.indexOf(channel);
    return index >= 0 && index < STARRED_HOTKEY_SLOTS ? index + 1 : undefined;
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <button
              type="button"
              aria-label="Switch channel"
              className="mx-2 mt-2 flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-left transition-colors hover:bg-gray-3 aria-expanded:bg-gray-3"
            >
              <span className="flex w-4 shrink-0 items-center justify-center">
                <HashIcon size={14} className="text-gray-10" />
              </span>
              <span className="min-w-0 flex-1 truncate font-semibold text-[13px] text-gray-12">
                {current?.name ?? "channel"}
              </span>
              <CaretUpDownIcon
                size={12}
                className="ml-1 shrink-0 text-gray-10"
              />
            </button>
          }
        />
        <PopoverContent
          align="start"
          side="bottom"
          sideOffset={4}
          // quill's popover ships `gap-4` plus unlayered `padding`/`width` CSS
          // that beats plain utilities, hence the `!` overrides — this is a
          // menu, not a card, so it gets menu-tight spacing.
          className="w-64! gap-0 p-1!"
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
                hotkeySlot={hotkeySlotFor(channel)}
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
              <p className="px-2 py-2 text-[12px] text-gray-10">
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
            className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[13px] text-gray-11 transition-colors hover:bg-gray-3"
          >
            <span className="flex w-4 shrink-0 items-center justify-center">
              <PlusIcon size={14} />
            </span>
            New channel…
          </button>
        </PopoverContent>
      </Popover>
      <CreateChannelModal open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}
