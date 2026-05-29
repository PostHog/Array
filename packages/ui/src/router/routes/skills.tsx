import { SkillsView } from "@posthog/ui/features/skills/SkillsView";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/skills")({
  component: SkillsView,
});
