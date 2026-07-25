import { ChartBarIcon, FileTextIcon, PlusIcon } from "@phosphor-icons/react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@posthog/quill";
import { ANALYTICS_EVENTS } from "@posthog/shared/analytics-events";
import { trackAndCreateCanvas } from "@posthog/ui/features/canvas/createCanvasAnalytics";
import { useCreateAndOpenDashboard } from "@posthog/ui/features/canvas/hooks/useDashboards";
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
 * The create affordance for the active channel, floated over the bottom-right
 * of its item list — the same treatment the channel list uses (see
 * ChannelsFab), and it opens its menu upward for the same reason.
 *
 * It sits here rather than in the nav stack because it is an action, not a
 * destination: as a bordered row directly under the channel switcher it read as
 * a second switcher, two equal-weight boxes competing at the top of the sidebar.
 */
export function NewTaskFab({ channelId }: { channelId: string }) {
  const hasDraft = useDraftStore(
    (s) => !isContentEmpty(s.drafts["task-input"]),
  );
  const createAndOpenCanvas = useCreateAndOpenDashboard(channelId);

  return (
    <DropdownMenu>
      <Tooltip
        content={hasDraft ? "Create — you have a draft" : "Create"}
        shortcut={formatHotkey(SHORTCUTS.NEW_TASK)}
        side="top"
      >
        <DropdownMenuTrigger
          render={
            <Button
              variant="primary"
              size="icon-lg"
              aria-label="Create"
              className="absolute right-3 bottom-3 z-10 rounded-full shadow-lg"
            >
              <PlusIcon size={20} weight="bold" />
              {/* Replaces the "Draft" badge the nav row carried: a pip in the
                  button's own foreground, so it stays legible on the accent
                  fill. */}
              {hasDraft && (
                <span
                  aria-hidden
                  className="absolute top-0.5 right-0.5 size-2 rounded-full bg-current ring-(--primary) ring-2"
                />
              )}
            </Button>
          }
        />
      </Tooltip>
      <DropdownMenuContent align="end" side="top" sideOffset={6}>
        <DropdownMenuItem
          onClick={() => {
            track(ANALYTICS_EVENTS.SIDEBAR_NAV_ITEM_CLICKED, {
              item: "new_task",
              in_more: false,
            });
            navigateToChannelNewTask(channelId);
          }}
        >
          <FileTextIcon size={14} />
          New task
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            // Create + open a canvas on the default template directly; the
            // canvas's own composer drives what gets built.
            trackAndCreateCanvas(
              channelId,
              undefined,
              "sidebar",
              () => void createAndOpenCanvas(),
            );
          }}
        >
          <ChartBarIcon size={14} />
          New canvas
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
