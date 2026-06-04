import { CommandCenterView } from "@features/command-center/components/CommandCenterView";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/command-center")({
  component: CommandCenterView,
});
