import { DotsThreeIcon } from "@phosphor-icons/react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@posthog/quill";
import { PROJECT_BLUEBIRD_FLAG } from "@posthog/shared";
import { useChannels } from "@posthog/ui/features/canvas/hooks/useChannels";
import { useFileTaskToChannel } from "@posthog/ui/features/canvas/hooks/useFileTaskToChannel";
import { useFeatureFlag } from "@posthog/ui/features/feature-flags/useFeatureFlag";
import { NestedButton } from "@posthog/ui/primitives/NestedButton";
import {
  type MenuFlyoutItem,
  MenuSubFlyout,
  SearchableMenuFlyout,
} from "@posthog/ui/primitives/SearchableMenuFlyout";
import type { ComponentType, ReactNode } from "react";

/**
 * What a task row's menu can do. The row owns the handlers because they're the
 * same ones its list already has (pin, archive, rename inline); only filing —
 * which needs the channel list and a mutation — belongs to the menu.
 */
export interface TaskRowMenuProps {
  taskId: string;
  taskTitle: string;
  isPinned: boolean;
  /** The channel this task is already filed to, ticked in "File to…". */
  channelId?: string;
  /** Absent when the command centre is full, which disables the item. */
  onAddToCommandCenter?: () => void;
  onRename: () => void;
  onTogglePin: () => void;
  onArchive: () => void;
}

// The two menus differ only in which primitives draw them, so the item list is
// written once against this shape. Base UI builds context menus on the same Menu
// parts as dropdowns, so the props line up; typing them structurally keeps the
// shared content from having to know which surface it's on.
interface MenuParts {
  Item: ComponentType<{
    children: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  }>;
  Separator: ComponentType<Record<string, never>>;
  Sub: ComponentType<{ children: ReactNode }>;
  SubTrigger: ComponentType<{ children: ReactNode }>;
}

const DROPDOWN_PARTS: MenuParts = {
  Item: DropdownMenuItem,
  Separator: DropdownMenuSeparator,
  Sub: DropdownMenuSub,
  SubTrigger: DropdownMenuSubTrigger,
};

const CONTEXT_PARTS: MenuParts = {
  Item: ContextMenuItem,
  Separator: ContextMenuSeparator,
  Sub: ContextMenuSub,
  SubTrigger: ContextMenuSubTrigger,
};

/**
 * The task row's actions, in the order the native menu used: the two edits, then
 * the two places a task can be sent, then the destructive one last.
 */
function TaskRowMenuItems({
  parts,
  menu,
}: {
  parts: MenuParts;
  menu: TaskRowMenuProps;
}) {
  const { Item, Separator, Sub, SubTrigger } = parts;
  // "File to…" is a Project Bluebird feature; gate the channel fetch behind the
  // flag so neither the submenu nor its request reaches ungated users.
  const bluebirdEnabled = useFeatureFlag(
    PROJECT_BLUEBIRD_FLAG,
    import.meta.env.DEV,
  );
  const { channels } = useChannels({ enabled: bluebirdEnabled });
  const fileToChannel = useFileTaskToChannel();

  const channelItems: MenuFlyoutItem[] = channels.map((channel) => ({
    id: channel.id,
    label: channel.name,
    current: channel.id === menu.channelId,
  }));

  return (
    <>
      <Item onClick={menu.onTogglePin}>{menu.isPinned ? "Unpin" : "Pin"}</Item>
      <Item onClick={menu.onRename}>Rename</Item>
      <Separator />
      <Item
        disabled={!menu.onAddToCommandCenter}
        onClick={menu.onAddToCommandCenter}
      >
        Add to Command Center
      </Item>
      {channelItems.length > 0 && (
        <>
          <Separator />
          <Sub>
            <SubTrigger>File to…</SubTrigger>
            <MenuSubFlyout className="w-64 p-0">
              <SearchableMenuFlyout
                items={channelItems}
                placeholder="Search spaces…"
                emptyLabel="No spaces"
                onSelect={(channelId) =>
                  fileToChannel(channelId, menu.taskId, menu.taskTitle)
                }
              />
            </MenuSubFlyout>
          </Sub>
        </>
      )}
      <Separator />
      <Item onClick={menu.onArchive}>Archive</Item>
    </>
  );
}

/**
 * The row's "…" button. Only rendered on hover by the row, so it's a button that
 * appears rather than one that dims — a row at rest shows its status, not its
 * controls.
 *
 * A `NestedButton` rather than a `<button>`: rows are real buttons and HTML
 * forbids nesting one inside another. It composes the trigger's injected
 * handlers and stops the click from reaching the row, which would otherwise open
 * the task behind the menu.
 */
export function TaskRowMenuButton({
  menu,
  className,
}: {
  menu: TaskRowMenuProps;
  className?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <NestedButton
            aria-label="Task actions"
            className={className}
            onActivate={() => {}}
          >
            <DotsThreeIcon size={14} weight="bold" />
          </NestedButton>
        }
      />
      <DropdownMenuContent align="end" side="bottom" className="w-56">
        <TaskRowMenuItems parts={DROPDOWN_PARTS} menu={menu} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The same menu on right-click, wrapping the row. */
export function TaskRowContextMenu({
  menu,
  children,
}: {
  menu: TaskRowMenuProps;
  children: ReactNode;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger render={<div className="min-w-0" />}>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <TaskRowMenuItems parts={CONTEXT_PARTS} menu={menu} />
      </ContextMenuContent>
    </ContextMenu>
  );
}
