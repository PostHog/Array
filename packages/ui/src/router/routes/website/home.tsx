import { HomeView } from "@posthog/ui/features/home/components/HomeView";
import { createFileRoute } from "@tanstack/react-router";

// Channels-space mirror of /code/home. Renders the same shared HomeView so the
// page stays single-source; only the route entry is duplicated so navigating
// here keeps the channels chrome (rail + channel sidebar).
export const Route = createFileRoute("/website/home")({
  component: HomeView,
});
