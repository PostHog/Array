import { ScoutDetailView } from "@posthog/ui/features/scouts/components/ScoutDetailView";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/code/agents/scouts/$skillName/")({
  component: ScoutDetailRoute,
});

function ScoutDetailRoute() {
  const { skillName } = Route.useParams();
  return <ScoutDetailView skillSlug={skillName} />;
}
