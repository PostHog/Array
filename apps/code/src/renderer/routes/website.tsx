import { BlankCanvas } from "@features/canvas/components/BlankCanvas";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/website")({
  component: BlankCanvas,
});
