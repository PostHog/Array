import { WebsiteNewTask } from "@features/canvas/components/WebsiteNewTask";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/website/new")({
  component: WebsiteNewTask,
});
