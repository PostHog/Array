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
 * The active channel's create affordance, floated over its item list the way
 * ChannelsFab is over the channel list — hence the upward menu. It lives here
 * rather than the nav stack because it is an action, not a destination.
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
              {/* In the button's own foreground, to stay legible on accent. */}
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
            // Default template; the canvas's composer drives what gets built.
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
