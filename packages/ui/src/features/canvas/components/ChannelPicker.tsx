import { CaretDown, HashIcon, Prohibit } from "@phosphor-icons/react";
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
import { useRef, useState } from "react";

// The opt-out option: run the task in the normal repo flow, not bound to a
// channel. Maps to a null value. The label can't collide with a channel name —
// those are lowercase/hyphen with no spaces.
const NO_CHANNEL_LABEL = "No channel";

interface ChannelPickerProps {
  /** Selected channel name, or `null` for "No channel" (normal repo flow). */
  value: string | null;
  onChange: (channelName: string | null) => void;
  /**
   * Channel names to list, already ordered by the parent (me → starred → rest).
   * The "No channel" option is prepended here.
   */
  channelNames: string[];
  isLoading: boolean;
  disabled?: boolean;
  // Accepted for API parity with the sibling pills; the button renders size="sm".
  size?: "1" | "2";
}

// A searchable pill for choosing which channel a new task runs in, sitting
// alongside the workspace-mode and repo pills on the new-task composer. Dumb +
// presentational: the parent owns the channels query, ordering, and selection.
// "No channel" keeps the normal repo flow; picking any channel (including the
// personal "me") makes the task run repo-less. Built on the same Combobox as the
// repo picker so you can type to filter a long list.
export function ChannelPicker({
  value,
  onChange,
  channelNames,
  isLoading,
  disabled,
}: ChannelPickerProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const items = [NO_CHANNEL_LABEL, ...channelNames];
  const selectedLabel = value ?? NO_CHANNEL_LABEL;

  return (
    <Combobox
      items={items}
      value={selectedLabel}
      onValueChange={(name) =>
        onChange(!name || name === NO_CHANNEL_LABEL ? null : name)
      }
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
            {value === null ? (
              <Prohibit
                size={14}
                weight="regular"
                className="shrink-0 text-muted-foreground"
              />
            ) : (
              <HashIcon
                size={14}
                weight="regular"
                className="shrink-0 text-muted-foreground"
              />
            )}
            <span className="min-w-0 truncate">{selectedLabel}</span>
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
              {name === NO_CHANNEL_LABEL ? (
                <Prohibit
                  size={14}
                  weight="regular"
                  className="shrink-0 text-muted-foreground"
                />
              ) : (
                <HashIcon
                  size={14}
                  weight="regular"
                  className="shrink-0 text-muted-foreground"
                />
              )}
              <span className="min-w-0 truncate">{name}</span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
