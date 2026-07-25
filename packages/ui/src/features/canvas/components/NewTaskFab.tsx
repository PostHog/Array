import { PlusIcon } from "@phosphor-icons/react";
import { Button } from "@posthog/quill";
import { ANALYTICS_EVENTS } from "@posthog/shared/analytics-events";
import {
  formatHotkey,
  SHORTCUTS,
} from "@posthog/ui/features/command/keyboard-shortcuts";
import { isContentEmpty } from "@posthog/ui/features/message-editor/content";
import { useDraftStore } from "@posthog/ui/features/message-editor/draftStore";
import { Tooltip } from "@posthog/ui/primitives/Tooltip";
import { navigateToChannelNewTask } from "@posthog/ui/router/navigationBridge";
import { track } from "@posthog/ui/shell/analytics";

/**
 * New task for the active channel, floated over the bottom-right of its item
 * list — the same create affordance the channel list uses (see ChannelsFab).
 *
 * It sits here rather than in the nav stack because it is an action, not a
 * destination: as a bordered row directly under the channel switcher it read as
 * a second switcher, two equal-weight boxes competing at the top of the sidebar.
 */
export function NewTaskFab({ channelId }: { channelId: string }) {
  const hasDraft = useDraftStore(
    (s) => !isContentEmpty(s.drafts["task-input"]),
  );

  return (
    <Tooltip
      content={hasDraft ? "New task — you have a draft" : "New task"}
      shortcut={formatHotkey(SHORTCUTS.NEW_TASK)}
      side="top"
    >
      <Button
        variant="primary"
        size="icon-lg"
        aria-label="New task"
        className="absolute right-3 bottom-3 z-10 rounded-full shadow-lg"
        onClick={() => {
          track(ANALYTICS_EVENTS.SIDEBAR_NAV_ITEM_CLICKED, {
            item: "new_task",
            in_more: false,
          });
          navigateToChannelNewTask(channelId);
        }}
      >
        <PlusIcon size={20} weight="bold" />
        {/* Replaces the "Draft" badge the nav row carried: a pip in the
            button's own foreground, so it stays legible on the accent fill. */}
        {hasDraft && (
          <span
            aria-hidden
            className="absolute top-0.5 right-0.5 size-2 rounded-full bg-current ring-(--primary) ring-2"
          />
        )}
      </Button>
    </Tooltip>
  );
}
