import { ErrorBoundary } from "@components/ErrorBoundary";
import { WebsiteCanvas } from "@features/canvas/components/WebsiteCanvas";
import { CanvasRenderer } from "@features/canvas/genui/registry";
import { useDashboard } from "@features/canvas/hooks/useDashboards";
import { useIsDashboardEditing } from "@features/canvas/stores/dashboardEditStore";
import { isNonEmptySpec } from "@json-render/core";
import type { Spec } from "@json-render/react";
import { Flex, ScrollArea, Text } from "@radix-ui/themes";

// Renders a saved json-render dashboard (read-only). In edit mode, swaps to the
// gen-UI canvas + chat for this dashboard's thread, where Save persists it.
export function WebsiteDashboard({ dashboardId }: { dashboardId: string }) {
  const editing = useIsDashboardEditing(dashboardId);
  const { dashboard, isLoading } = useDashboard(dashboardId);

  if (editing) {
    return <WebsiteCanvas threadId={`dashboard:${dashboardId}`} />;
  }

  const spec = dashboard?.spec as Spec | null | undefined;

  return (
    <ScrollArea className="h-full bg-gray-1">
      {isNonEmptySpec(spec) ? (
        <ErrorBoundary name="dashboard-renderer" resetKey={spec}>
          <CanvasRenderer spec={spec} />
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
            {isLoading ? "Loading…" : "Empty dashboard"}
          </Text>
          {!isLoading && (
            <Text size="2" className="text-gray-10">
              Hit Edit to build this dashboard with the agent, then Save.
            </Text>
          )}
        </Flex>
      )}
    </ScrollArea>
  );
}
