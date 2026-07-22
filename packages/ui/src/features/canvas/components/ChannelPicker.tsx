import { CaretDown, HashIcon } from "@phosphor-icons/react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  MenuLabel,
} from "@posthog/quill";
import type { Channel } from "../hooks/useChannels";

// Radio values must be non-empty strings, and `null` can't key a radio item, so
// "No channel" gets a sentinel value that maps back to `null` on change.
const NO_CHANNEL_VALUE = "__none__";

interface ChannelPickerProps {
  /** Selected channel folder id, or `null` for "No channel" (work in a repo). */
  value: string | null;
  onChange: (channelId: string | null) => void;
  /** Channels to list, already filtered by the parent (e.g. #me removed). */
  channels: Channel[];
  isLoading: boolean;
  disabled?: boolean;
  // Accepted for API parity with the sibling pills; the button renders size="sm".
  size?: "1" | "2";
}

// A pill for choosing which channel a new task runs in, sitting alongside the
// workspace-mode and repo pills on the new-task composer. Dumb + presentational:
// the parent owns the channels query and the selected id. Picking a channel makes
// the task run repo-less (the parent greys out the repo/branch pickers); "No
// channel" restores the normal repo flow.
export function ChannelPicker({
  value,
  onChange,
  channels,
  isLoading,
  disabled,
}: ChannelPickerProps) {
  const selected = value ? channels.find((c) => c.id === value) : undefined;
  const triggerLabel = selected ? `#${selected.name}` : "No channel";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            aria-label="Channel"
          >
            <span className="text-muted-foreground">
              <HashIcon size={14} weight="regular" />
            </span>
            {triggerLabel}
            <CaretDown
              size={10}
              weight="bold"
              className="text-muted-foreground"
            />
          </Button>
        }
      />
      <DropdownMenuContent
        align="start"
        side="bottom"
        sideOffset={6}
        className="w-auto min-w-[220px]"
      >
        <MenuLabel>Channel</MenuLabel>
        <DropdownMenuRadioGroup
          value={value ?? NO_CHANNEL_VALUE}
          onValueChange={(next) =>
            onChange(next === NO_CHANNEL_VALUE ? null : next)
          }
        >
          <DropdownMenuRadioItem value={NO_CHANNEL_VALUE}>
            <span className="text-muted-foreground">
              <HashIcon size={14} weight="regular" />
            </span>
            <span className="whitespace-nowrap">
              No channel · work in a repo
            </span>
          </DropdownMenuRadioItem>
          {channels.map((channel) => (
            <DropdownMenuRadioItem key={channel.id} value={channel.id}>
              <span className="text-muted-foreground">
                <HashIcon size={14} weight="regular" />
              </span>
              <span className="whitespace-nowrap">{channel.name}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {isLoading && channels.length === 0 && (
          <div className="px-2 py-1.5 text-muted-foreground text-xs">
            Loading channels…
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
