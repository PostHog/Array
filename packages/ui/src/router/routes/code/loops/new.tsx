import { LoopForm } from "@posthog/ui/features/loops/components/LoopForm";
import { validateLoopRouteSearch } from "@posthog/ui/features/loops/loopNavigation";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/code/loops/new")({
  validateSearch: validateLoopRouteSearch,
  component: NewLoopRoute,
});

function NewLoopRoute() {
  const { channelId } = Route.useSearch();
  return <LoopForm returnChannelId={channelId} />;
}
