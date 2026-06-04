import { ArchivedTasksView } from "@features/archive/components/ArchivedTasksView";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/code/archived")({
  component: ArchivedTasksView,
});
