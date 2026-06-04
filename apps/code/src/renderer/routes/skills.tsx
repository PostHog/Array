import { SkillsView } from "@features/skills/components/SkillsView";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/skills")({
  component: SkillsView,
});
