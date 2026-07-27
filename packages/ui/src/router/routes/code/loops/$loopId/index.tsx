import { LoopDetailView } from "@posthog/ui/features/loops/components/LoopDetailView";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/code/loops/$loopId/")({
  component: LoopDetailRoute,
});

function LoopDetailRoute() {
  const { loopId } = Route.useParams();
  const { channelId } = Route.useSearch();
  return <LoopDetailView loopId={loopId} returnChannelId={channelId} />;
}
