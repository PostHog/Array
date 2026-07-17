import { Globe, Plus, Terminal } from "@phosphor-icons/react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@posthog/quill";
import type { AddableTabKind } from "@posthog/ui/features/panels/tabAvailability";
import { Tooltip } from "@posthog/ui/primitives/Tooltip";
import { TabBarButton } from "./TabBarButton";

interface AddTabControlProps {
  addableTabKinds: readonly AddableTabKind[];
  onAddTab: (kind: AddableTabKind) => void;
}

export function AddTabControl({
  addableTabKinds,
  onAddTab,
}: AddTabControlProps) {
  const singleAddableTabKind =
    addableTabKinds.length === 1 ? addableTabKinds[0] : undefined;

  if (singleAddableTabKind) {
    const isTerminal = singleAddableTabKind === "terminal";
    return (
      <Tooltip
        content={isTerminal ? "New terminal" : "New browser tab"}
        side="bottom"
      >
        <TabBarButton
          ariaLabel={isTerminal ? "Add terminal" : "Add browser tab"}
          dataAttr={isTerminal ? "panel-add-terminal" : "panel-add-browser-tab"}
          onClick={() => onAddTab(singleAddableTabKind)}
        >
          {isTerminal ? <Plus size={14} /> : <Globe size={14} />}
        </TabBarButton>
      </Tooltip>
    );
  }

  if (addableTabKinds.length === 0) return null;

  const canAddTerminal = addableTabKinds.includes("terminal");
  const canAddBrowser = addableTabKinds.includes("browser");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <TabBarButton ariaLabel="Add tab" dataAttr="panel-add-tab">
            <Plus size={14} />
          </TabBarButton>
        }
      />
      <DropdownMenuContent
        align="start"
        side="bottom"
        sideOffset={4}
        className="min-w-[140px]"
      >
        {canAddTerminal && (
          <DropdownMenuItem
            data-attr="panel-add-terminal"
            onClick={() => onAddTab("terminal")}
          >
            <Terminal size={14} />
            Terminal
          </DropdownMenuItem>
        )}
        {canAddBrowser && (
          <DropdownMenuItem
            data-attr="panel-add-browser-tab"
            onClick={() => onAddTab("browser")}
          >
            <Globe size={14} />
            Browser
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
