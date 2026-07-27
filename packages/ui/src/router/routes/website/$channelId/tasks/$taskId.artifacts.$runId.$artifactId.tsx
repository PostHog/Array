import { ArtifactPreview } from "@posthog/ui/features/sessions/components/ArtifactPreview";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

export const Route = createFileRoute(
  "/website/$channelId/tasks/$taskId/artifacts/$runId/$artifactId",
)({
  validateSearch: z.object({ name: z.string().catch("Artifact") }),
  component: ArtifactPreviewRoute,
});

function ArtifactPreviewRoute() {
  const { channelId: _, ...params } = Route.useParams();
  const { name } = Route.useSearch();
  return <ArtifactPreview {...params} name={name} />;
}
