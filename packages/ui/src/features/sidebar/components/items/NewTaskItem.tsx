import { Plus } from "@phosphor-icons/react";
import { Badge, Button, cn } from "@posthog/quill";
import { SHORTCUTS } from "@posthog/ui/features/command/keyboard-shortcuts";
import { isContentEmpty } from "@posthog/ui/features/message-editor/content";
import { useDraftStore } from "@posthog/ui/features/message-editor/draftStore";
import { SidebarItem } from "../SidebarItem";
import { SidebarKbdHint } from "./SidebarKbdHint";

interface NewTaskItemProps {
  isActive: boolean;
  onClick: () => void;
  /**
   * Renders as a raised button rather than a plain nav row — for surfaces where
   * New task is the primary action sitting next to a list of destinations,
   * rather than one row among equals.
   */
  elevated?: boolean;
}

export function NewTaskItem({
  isActive,
  onClick,
  elevated = false,
}: NewTaskItemProps) {
  const hasDraft = useDraftStore(
    (s) => !isContentEmpty(s.drafts["task-input"]),
  );
  const draftBadge = hasDraft ? (
    <Badge variant="default" title="You have unsubmitted changes">
      Draft
    </Badge>
  ) : null;

  if (elevated) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={onClick}
        // `group` sits alongside quill's own `group/button` so the kbd hint
        // reveals on hover exactly as it does on a sidebar row.
        className={cn(
          "group w-full justify-start gap-2",
          isActive && "bg-fill-selected",
        )}
      >
        <Plus size={16} weight={isActive ? "bold" : "regular"} />
        <span className="flex-1 text-left">New task</span>
        {draftBadge}
        <SidebarKbdHint keys={SHORTCUTS.NEW_TASK} />
      </Button>
    );
  }

  return (
    <SidebarItem
      depth={0}
      icon={<Plus size={16} weight={isActive ? "bold" : "regular"} />}
      label="New task"
      isActive={isActive}
      onClick={onClick}
      endContent={
        <>
          {draftBadge}
          <SidebarKbdHint keys={SHORTCUTS.NEW_TASK} />
        </>
      }
    />
  );
}
