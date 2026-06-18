import { MagnifyingGlass } from "@phosphor-icons/react";
import { SHORTCUTS } from "@posthog/ui/features/command/keyboard-shortcuts";
import { SidebarItem } from "../SidebarItem";
import { SidebarKbdHint } from "./SidebarKbdHint";

interface SearchItemProps {
  onClick: () => void;
}

export function SearchItem({ onClick }: SearchItemProps) {
  return (
    <SidebarItem
      depth={0}
      icon={<MagnifyingGlass size={16} />}
      label="Search"
      onClick={onClick}
      endContent={<SidebarKbdHint keys={SHORTCUTS.COMMAND_MENU} />}
    />
  );
}
