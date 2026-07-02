import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import { CaretDown } from "@phosphor-icons/react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  MenuLabel,
} from "@posthog/quill";
import { getModeStyle } from "@posthog/ui/features/sessions/modeStyles";
import { flattenSelectOptions } from "@posthog/ui/features/sessions/sessionStore";
import { useRetainedConfigOption } from "@posthog/ui/features/sessions/useRetainedConfigOption";
import { useRef, useState } from "react";

interface ModeSelectorProps {
  modeOption: SessionConfigOption | undefined;
  onChange: (value: string) => void;
  allowBypassPermissions: boolean;
  disabled?: boolean;
}

export function ModeSelector({
  modeOption,
  onChange,
  allowBypassPermissions,
  disabled,
}: ModeSelectorProps) {
  const [open, setOpen] = useState(false);
  const pendingValueRef = useRef<string | null>(null);
  const displayOption = useRetainedConfigOption(modeOption);

  if (!displayOption || displayOption.type !== "select") return null;

  // `modeOption` blanks out while the preview config reloads (e.g. a harness
  // switch). Keep showing the last mode, disabled, so the toolbar stays put
  // instead of collapsing and snapping the open model menu sideways.
  const isReloading = !modeOption;
  const isDisabled = disabled || isReloading;

  const allOptions = flattenSelectOptions(displayOption.options);
  const options = allowBypassPermissions
    ? allOptions
    : allOptions.filter(
        (opt) =>
          opt.value !== "bypassPermissions" && opt.value !== "full-access",
      );
  if (options.length === 0) return null;

  const currentValue = displayOption.currentValue;
  const currentStyle = getModeStyle(currentValue);
  const currentLabel =
    allOptions.find((opt) => opt.value === currentValue)?.name ?? currentValue;

  return (
    <DropdownMenu
      open={open}
      onOpenChange={setOpen}
      onOpenChangeComplete={(isOpen) => {
        if (!isOpen && pendingValueRef.current !== null) {
          onChange(pendingValueRef.current);
          pendingValueRef.current = null;
        }
      }}
    >
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="default"
            size="sm"
            disabled={isDisabled}
            aria-label="Mode"
          >
            <span className={currentStyle.className}>{currentStyle.icon}</span>
            <span className={currentStyle.className}>{currentLabel}</span>
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
        side="top"
        sideOffset={6}
        className={allowBypassPermissions ? "min-w-[220px]" : "min-w-[200px]"}
      >
        <MenuLabel>Mode</MenuLabel>
        <DropdownMenuRadioGroup
          value={currentValue}
          onValueChange={(value) => {
            pendingValueRef.current = value;
            setOpen(false);
          }}
        >
          {options.map((option) => {
            const style = getModeStyle(option.value);
            return (
              <DropdownMenuRadioItem key={option.value} value={option.value}>
                <span className={`${style.className}`}>{style.icon}</span>
                <span className="whitespace-nowrap">{option.name}</span>
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
