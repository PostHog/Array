import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@posthog/quill";
import type { Task } from "@posthog/shared/domain-types";
import { TaskInput } from "@posthog/ui/features/task-detail/components/TaskInput";

export function ChannelCreateTaskDialog({
  open,
  channelId,
  backendChannelId,
  channelName,
  channelContext,
  onOpenChange,
  onTaskCreated,
}: {
  open: boolean;
  channelId: string;
  backendChannelId: string;
  channelName?: string;
  channelContext?: string;
  onOpenChange: (open: boolean) => void;
  onTaskCreated: (task: Task) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[min(380px,calc(100vh-48px))] w-[min(720px,calc(100vw-48px))] max-w-none gap-0 overflow-hidden p-0 sm:max-w-none">
        <DialogTitle className="sr-only">Create task</DialogTitle>
        <DialogDescription className="sr-only">
          Create a task in {channelName ?? "this channel"}.
        </DialogDescription>
        <TaskInput
          onTaskCreated={(task) => {
            onTaskCreated(task);
            onOpenChange(false);
          }}
          channelContext={channelContext}
          channelName={channelName}
          channelId={backendChannelId}
          channelContextId={channelId}
          allowNoRepo
          suggestions={[]}
        />
      </DialogContent>
    </Dialog>
  );
}
