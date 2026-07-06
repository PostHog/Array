import { UsageView } from "@posthog/ui/features/usage/UsageView";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/usage")({
  component: UsageView,
});
