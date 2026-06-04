import { WebsiteCanvas } from "@features/canvas/components/WebsiteCanvas";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/website")({
  component: WebsiteCanvas,
});
