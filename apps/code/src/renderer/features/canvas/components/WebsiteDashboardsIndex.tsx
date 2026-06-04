import {
  useCreateAndOpenDashboard,
  useDashboards,
} from "@features/canvas/hooks/useDashboards";
import { PlusIcon } from "@phosphor-icons/react";
import { Button } from "@posthog/quill";
import { Flex, Text } from "@radix-ui/themes";
import { Navigate } from "@tanstack/react-router";

// /website index: redirect to the most recent dashboard, or offer to create the
// first one when none exist yet.
export function WebsiteDashboardsIndex() {
  const { dashboards, isLoading } = useDashboards();
  const createAndOpen = useCreateAndOpenDashboard();

  if (isLoading) return null;

  if (dashboards.length > 0) {
    return (
      <Navigate
        to="/website/dashboards/$dashboardId"
        params={{ dashboardId: dashboards[0].id }}
        replace
      />
    );
  }

  return (
    <Flex
      direction="column"
      align="center"
      justify="center"
      height="100%"
      gap="3"
      className="px-6 text-center"
    >
      <Flex direction="column" gap="1">
        <Text size="3" weight="bold" className="text-gray-12">
          No dashboards yet
        </Text>
        <Text size="2" className="text-gray-10">
          Create one and build it with the agent, then save it.
        </Text>
      </Flex>
      <Button variant="primary" onClick={() => void createAndOpen()}>
        <PlusIcon size={14} />
        Create dashboard
      </Button>
    </Flex>
  );
}
