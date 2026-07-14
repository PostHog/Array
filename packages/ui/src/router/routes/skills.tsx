import { SkillsView } from "@posthog/ui/features/skills/SkillsView";
import {
  AppPageSkeleton,
  withRouteSkeleton,
} from "@posthog/ui/router/routeSkeletons";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/skills")({
  component: SkillsView,
  ...withRouteSkeleton(AppPageSkeleton),
});
