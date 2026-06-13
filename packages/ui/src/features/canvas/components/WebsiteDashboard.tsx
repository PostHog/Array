import { isNonEmptySpec } from "@json-render/core";
import type { Spec } from "@json-render/react";
import { WebsiteCanvas } from "@posthog/ui/features/canvas/components/WebsiteCanvas";
import { ViewRenderer } from "@posthog/ui/features/canvas/genui/ViewRenderer";
import { useDashboard } from "@posthog/ui/features/canvas/hooks/useDashboards";
import { useCanvasChatStore } from "@posthog/ui/features/canvas/stores/canvasChatStore";
import { useIsDashboardEditing } from "@posthog/ui/features/canvas/stores/dashboardEditStore";
import { ErrorBoundary } from "@posthog/ui/shell/ErrorBoundary";
import { Flex, ScrollArea, Text } from "@radix-ui/themes";
import { useEffect } from "react";

// Renders a saved json-render dashboard (read-only). In edit mode, swaps to the
// gen-UI canvas + chat for this dashboard's thread, where Save persists it.
export function WebsiteDashboard({ dashboardId }: { dashboardId: string }) {
  const editing = useIsDashboardEditing(dashboardId);
  const { dashboard, isLoading } = useDashboard(dashboardId);
  const ensureSpec = useCanvasChatStore((s) => s.ensureSpec);
  const setTemplate = useCanvasChatStore((s) => s.setTemplate);

  const threadId = `dashboard:${dashboardId}`;
  const spec = dashboard?.spec as Spec | null | undefined;
  const templateId = dashboard?.templateId;

  // Entering edit on an existing dashboard: seed the canvas thread with the
  // saved spec so the agent refines the current board instead of a blank
  // canvas (which is what made Edit appear to wipe the dashboard).
  useEffect(() => {
    if (editing && isNonEmptySpec(spec)) ensureSpec(threadId, spec);
  }, [editing, threadId, spec, ensureSpec]);

  // Anchor the thread's agent to this canvas's template (so it builds with the
  // right context — Dashboard vs Blank — from the first message).
  useEffect(() => {
    if (templateId) setTemplate(threadId, templateId);
  }, [threadId, templateId, setTemplate]);

  if (editing) {
    return <WebsiteCanvas threadId={threadId} />;
  }

  return (
    <ScrollArea className="scroll-mask-4 h-full bg-background">
      {isNonEmptySpec(spec) ? (
        <ErrorBoundary name="dashboard-renderer" resetKey={spec}>
          <ViewRenderer spec={spec} dashboardId={dashboardId} />
        </ErrorBoundary>
      ) : (
        <Flex
          direction="column"
          align="center"
          justify="center"
          height="100%"
          gap="1"
          className="px-6 text-center"
        >
          <Text size="3" weight="bold" className="text-gray-12">
            {isLoading ? "Loading…" : "Empty canvas"}
          </Text>
          {!isLoading && (
            <Text size="2" className="text-gray-10">
              Hit Edit to build this canvas with the agent, then Save.
            </Text>
          )}
        </Flex>
      )}
    </ScrollArea>
  );
}
