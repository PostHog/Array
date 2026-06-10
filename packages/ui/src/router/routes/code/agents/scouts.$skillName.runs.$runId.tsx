import { ScoutRunDetailView } from "@posthog/ui/features/scouts/components/ScoutRunDetailView";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute(
  "/code/agents/scouts/$skillName/runs/$runId",
)({
  component: ScoutRunDetailRoute,
});

function ScoutRunDetailRoute() {
  const { skillName, runId } = Route.useParams();
  return <ScoutRunDetailView skillSlug={skillName} runId={runId} />;
}
