import type { Task } from "@posthog/shared/domain-types";
import { ThreadPanel } from "@posthog/ui/features/canvas/components/ThreadPanel";
import { useThreadPanelStore } from "@posthog/ui/features/canvas/stores/threadPanelStore";
import { ResizableSidebar } from "@posthog/ui/primitives/ResizableSidebar";
import { useState } from "react";

// The right-hand dock hosting a task's ThreadPanel: a thin rail when
// collapsed, a resizable sidebar otherwise. Shared by the channel feed and the
// task detail route; owns the panel-store size/collapse reads so parents don't
// re-render on every resize tick.
export function ThreadSidebar({
  taskId,
  task,
  onClose,
}: {
  taskId: string;
  /** The thread's task when the caller already has it; fetched otherwise. */
  task?: Task;
  onClose?: () => void;
}) {
  const collapsed = useThreadPanelStore((s) => s.collapsed);
  const width = useThreadPanelStore((s) => s.width);
  const setWidth = useThreadPanelStore((s) => s.setWidth);
  const setCollapsed = useThreadPanelStore((s) => s.setCollapsed);
  const [isResizing, setIsResizing] = useState(false);

  if (collapsed) {
    return (
      <ThreadPanel
        taskId={taskId}
        task={task}
        collapsed
        onToggleCollapsed={() => setCollapsed(false)}
      />
    );
  }

  return (
    <ResizableSidebar
      open
      width={width}
      setWidth={setWidth}
      isResizing={isResizing}
      setIsResizing={setIsResizing}
      side="right"
    >
      <ThreadPanel
        taskId={taskId}
        task={task}
        onClose={onClose}
        onToggleCollapsed={() => setCollapsed(true)}
      />
    </ResizableSidebar>
  );
}
