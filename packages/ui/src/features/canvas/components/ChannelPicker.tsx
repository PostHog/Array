import { CaretDown, HashIcon } from "@phosphor-icons/react";
import {
  Button,
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from "@posthog/quill";
import { useMemo, useRef, useState } from "react";
import type { Channel } from "../hooks/useChannels";

// The default option: the user's personal channel. Selecting it maps to a null
// id, which the composer treats as "no explicit channel" — the task still runs
// in the normal repo flow and useTaskCreation routes it to the #me feed.
const PERSONAL_CHANNEL_LABEL = "me";

interface ChannelPickerProps {
  /** Selected channel folder id, or `null` for the personal "me" channel. */
  value: string | null;
  onChange: (channelId: string | null) => void;
  /** Channels to list, already filtered by the parent (e.g. #me removed). */
  channels: Channel[];
  isLoading: boolean;
  disabled?: boolean;
  // Accepted for API parity with the sibling pills; the button renders size="sm".
  size?: "1" | "2";
}

// A searchable pill for choosing which channel a new task runs in, sitting
// alongside the workspace-mode and repo pills on the new-task composer. Dumb +
// presentational: the parent owns the channels query and the selected id.
// Picking a named channel makes the task run repo-less (the parent greys out the
// repo/branch pickers); the default "me" restores the normal repo flow. Built on
// the same Combobox as the repo picker so you can type to filter a long list.
export function ChannelPicker({
  value,
  onChange,
  channels,
  isLoading,
  disabled,
}: ChannelPickerProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  // "me" leads, then the real channels. The combobox filters on these names, so
  // its value is a channel name (or "me") that we map back to an id on change.
  const optionNames = useMemo(
    () => [PERSONAL_CHANNEL_LABEL, ...channels.map((c) => c.name)],
    [channels],
  );
  const selectedName = value
    ? (channels.find((c) => c.id === value)?.name ?? PERSONAL_CHANNEL_LABEL)
    : PERSONAL_CHANNEL_LABEL;

  return (
    <Combobox
      items={optionNames}
      value={selectedName}
      onValueChange={(name) => {
        if (!name || name === PERSONAL_CHANNEL_LABEL) {
          onChange(null);
          return;
        }
        onChange(channels.find((c) => c.name === name)?.id ?? null);
      }}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSearch("");
      }}
      inputValue={search}
      onInputValueChange={setSearch}
      disabled={disabled}
    >
      <ComboboxTrigger
        render={
          <Button
            ref={triggerRef}
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            aria-label="Channel"
          >
            <HashIcon
              size={14}
              weight="regular"
              className="shrink-0 text-muted-foreground"
            />
            <span className="min-w-0 truncate">{selectedName}</span>
            <CaretDown
              size={10}
              weight="bold"
              className="text-muted-foreground"
            />
          </Button>
        }
      />
      <ComboboxContent
        anchor={triggerRef}
        side="bottom"
        sideOffset={6}
        className="min-w-[240px]"
      >
        <ComboboxInput placeholder="Search channels..." />
        <ComboboxEmpty>
          {isLoading ? "Loading channels…" : "No channels found."}
        </ComboboxEmpty>
        <ComboboxList>
          {(name: string) => (
            <ComboboxItem key={name} value={name}>
              <HashIcon
                size={14}
                weight="regular"
                className="shrink-0 text-muted-foreground"
              />
              <span className="min-w-0 truncate">{name}</span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
