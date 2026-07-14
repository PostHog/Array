import { McpServersView } from "@posthog/ui/features/mcp-servers/components/McpServersView";
import {
  AppPageSkeleton,
  withRouteSkeleton,
} from "@posthog/ui/router/routeSkeletons";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/mcp-servers")({
  component: McpServersView,
  ...withRouteSkeleton(AppPageSkeleton),
});
