import { NotebookView } from "@posthog/ui/features/notebooks/NotebookView";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/notebooks/$shortId")({
  component: NotebookRoute,
});

function NotebookRoute() {
  const { shortId } = Route.useParams();
  // Remount the whole editing surface when switching notebooks so editor
  // state (undo history, sync engine baseline) never leaks across documents.
  return <NotebookView key={shortId} shortId={shortId} />;
}
