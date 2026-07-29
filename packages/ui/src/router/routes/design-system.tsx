import { DesignSystemView } from "@posthog/ui/features/design-system/DesignSystemView";
import {
  AppPageSkeleton,
  withRouteSkeleton,
} from "@posthog/ui/router/routeSkeletons";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/design-system")({
  component: DesignSystemView,
  ...withRouteSkeleton(AppPageSkeleton),
});
