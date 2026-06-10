import { ScoutsView } from "@posthog/ui/features/scouts/components/ScoutsView";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/code/agents/scouts/")({
  component: ScoutsView,
});
