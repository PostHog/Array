import { NotebooksView } from "@posthog/ui/features/notebooks/NotebooksView";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/notebooks/")({
  component: NotebooksView,
});
