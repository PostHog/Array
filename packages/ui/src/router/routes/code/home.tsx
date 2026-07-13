import { HomeView } from "@posthog/ui/features/home/components/HomeView";
import {
  AppPageSkeleton,
  withRouteSkeleton,
} from "@posthog/ui/router/routeSkeletons";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/code/home")({
  component: HomeView,
  ...withRouteSkeleton(AppPageSkeleton),
});
