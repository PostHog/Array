import { WebsiteSettings } from "@features/canvas/components/WebsiteSettings";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/website/settings")({
  component: WebsiteSettings,
});
