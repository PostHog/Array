import { validateLoopRouteSearch } from "@posthog/ui/features/loops/loopNavigation";
import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/code/loops/$loopId")({
  validateSearch: validateLoopRouteSearch,
  component: Outlet,
});
