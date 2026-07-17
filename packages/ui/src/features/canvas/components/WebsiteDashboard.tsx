import { WORKFLOW_TEMPLATE_ID } from "@posthog/core/canvas/freeformSchemas";
import { FreeformCanvasView } from "@posthog/ui/features/canvas/freeform/FreeformCanvasView";
import { useDashboard } from "@posthog/ui/features/canvas/hooks/useDashboards";
import { useIsDashboardEditing } from "@posthog/ui/features/canvas/stores/dashboardEditStore";
import { useFreeformChatStore } from "@posthog/ui/features/canvas/stores/freeformChatStore";
import { useEffect } from "react";

// Renders a canvas's React app in a sandboxed iframe (view + edit). Edit mode
// adds the chat panel + version controls; generation runs as a dedicated task.
export function WebsiteDashboard({ dashboardId }: { dashboardId: string }) {
  const editing = useIsDashboardEditing(dashboardId);
  const { dashboard } = useDashboard(dashboardId);
  const syncFromRecord = useFreeformChatStore((s) => s.syncFromRecord);

  const threadId = `dashboard:${dashboardId}`;

  // Seed the thread from the saved record (code + version history) when its data
  // lands, so undo/redo and the live render reflect what's stored — and adopt a
  // version a generation task just published.
  useEffect(() => {
    if (!dashboard) return;
    syncFromRecord(threadId, {
      code: dashboard.code,
      versions: dashboard.versions,
      currentVersionId: dashboard.currentVersionId,
      templateId: dashboard.templateId,
      context: dashboard.context,
    });
  }, [dashboard, threadId, syncFromRecord]);

  // Workflow canvases always open with the agent chat on the right so users
  // can ask about the workflow or request changes — and so a build whose
  // metrics canvas hasn't published yet lands on the composer, not a dead-end
  // "this canvas is empty" view. Regular canvases keep the view-first default.
  const isWorkflowCanvas =
    !!dashboard?.workflow || dashboard?.templateId === WORKFLOW_TEMPLATE_ID;
  const interactive = editing || isWorkflowCanvas;

  return <FreeformCanvasView threadId={threadId} interactive={interactive} />;
}
