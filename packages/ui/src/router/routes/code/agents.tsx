import { AgentBuilderDockLayout } from "@posthog/ui/features/agent-applications/agent-builder/AgentBuilderDockLayout";
import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/code/agents")({
  component: AgentsLayout,
});

function AgentsLayout() {
  return (
    <AgentBuilderDockLayout>
      <Outlet />
    </AgentBuilderDockLayout>
  );
}
