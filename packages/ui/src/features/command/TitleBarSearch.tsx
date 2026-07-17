import { MagnifyingGlass } from "@phosphor-icons/react";
import { Button, Kbd } from "@posthog/quill";
import { formatHotkeyParts, SHORTCUTS } from "./keyboard-shortcuts";

interface TitleBarSearchProps {
  onClick: () => void;
}

export function TitleBarSearch({ onClick }: TitleBarSearchProps) {
  return (
    <div className="no-drag flex min-w-0 flex-1 justify-center px-4">
      <Button
        variant="outline"
        size="sm"
        className="h-7 w-full max-w-[520px] justify-start gap-2 bg-gray-3/80 px-2.5 text-gray-11 shadow-sm backdrop-blur-sm hover:bg-gray-4 hover:text-gray-12"
        aria-label="Search PostHog Code"
        onClick={onClick}
      >
        <MagnifyingGlass size={14} className="shrink-0" />
        <span className="truncate">Search PostHog Code</span>
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {formatHotkeyParts(SHORTCUTS.COMMAND_MENU).map((part) => (
            <Kbd key={part}>{part}</Kbd>
          ))}
        </span>
      </Button>
    </div>
  );
}
