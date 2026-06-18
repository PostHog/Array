import { CommandCenterView } from "@posthog/ui/features/command-center/components/CommandCenterView";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/command-center")({
  component: CommandCenterView,
});
