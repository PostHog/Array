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
import { openTaskInput } from "@posthog/ui/router/useOpenTask";
import { track } from "@posthog/ui/shell/analytics";

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
            openTaskInput({ channelId });
          }}
        >
          <FileTextIcon size={14} />
          New task
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
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
