import { HomeView } from "@posthog/ui/features/home/components/HomeView";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/code/home")({
  component: HomeView,
});
