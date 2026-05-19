import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import {
  CaretDown,
  Circle,
  Eye,
  LockOpen,
  Pause,
  Pencil,
  Robot,
  ShieldCheck,
} from "@phosphor-icons/react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  MenuLabel,
} from "@posthog/quill";
import { flattenSelectOptions } from "@renderer/features/sessions/stores/sessionStore";

interface ModeStyle {
  icon: React.ReactNode;
  className: string;
}

const MODE_STYLES: Record<string, ModeStyle> = {
  plan: {
    icon: <Pause size={12} weight="bold" />,
    className: "text-amber-11",
  },
  default: {
    icon: <Pencil size={12} />,
    className: "text-gray-11",
  },
  acceptEdits: {
    icon: <ShieldCheck size={12} weight="fill" />,
    className: "text-green-11",
  },
  bypassPermissions: {
    icon: <LockOpen size={12} weight="bold" />,
    className: "text-red-11",
  },
  auto: {
    icon: <Robot size={12} weight="fill" />,
    className: "text-blue-11",
  },
  "read-only": {
    icon: <Eye size={12} />,
    className: "text-amber-11",
  },
  "full-access": {
    icon: <LockOpen size={12} weight="bold" />,
    className: "text-red-11",
  },
};

const DEFAULT_STYLE: ModeStyle = {
  icon: <Circle size={12} />,
  className: "text-gray-11",
};

function getStyle(value: string): ModeStyle {
  return MODE_STYLES[value] ?? DEFAULT_STYLE;
}

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
  if (!modeOption || modeOption.type !== "select") return null;

  const allOptions = flattenSelectOptions(modeOption.options);
  const options = allowBypassPermissions
    ? allOptions
    : allOptions.filter(
        (opt) =>
          opt.value !== "bypassPermissions" && opt.value !== "full-access",
      );
  if (options.length === 0) return null;

  const currentValue = modeOption.currentValue;
  const currentStyle = getStyle(currentValue);
  const currentLabel =
    allOptions.find((opt) => opt.value === currentValue)?.name ?? currentValue;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="default"
            size="sm"
            disabled={disabled}
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
        <DropdownMenuRadioGroup value={currentValue} onValueChange={onChange}>
          {options.map((option) => {
            const style = getStyle(option.value);
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
