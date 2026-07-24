import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@posthog/quill";
import type { Task } from "@posthog/shared/domain-types";
import { ThreadPanel } from "@posthog/ui/features/canvas/components/ThreadPanel";
import type { SidebarPrState } from "@posthog/ui/features/sidebar/useTaskPrStatus";

export function ChannelTaskPreviewDialog({
  task,
  channelId,
  prUrl,
  prState,
  onClose,
  onOpenFull,
}: {
  task: Task | null;
  channelId: string;
  prUrl?: string;
  prState: SidebarPrState;
  onClose: () => void;
  onOpenFull: (task: Task) => void;
}) {
  return (
    <Dialog open={!!task} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="h-[min(820px,calc(100vh-48px))] w-[min(960px,calc(100vw-48px))] max-w-none gap-0 overflow-hidden p-0 sm:max-w-none"
      >
        <DialogTitle className="sr-only">
          {task?.title || "Task preview"}
        </DialogTitle>
        <DialogDescription className="sr-only">
          Preview the task conversation without leaving the channel board.
        </DialogDescription>
        {task ? (
          <ThreadPanel
            taskId={task.id}
            channelId={channelId}
            task={task}
            onClose={onClose}
            onOpenFull={() => onOpenFull(task)}
            showAgentStatus={false}
            taskSummaryInHeader
            taskSummaryPrUrl={prUrl}
            taskSummaryPrState={prState}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
