import { SkillsView } from "@posthog/ui/features/skills/SkillsView";
import { createFileRoute } from "@tanstack/react-router";

// Channels-space mirror of /skills. Renders the same shared SkillsView so the
// page stays single-source; only the route entry is duplicated so navigating
// here keeps the channels chrome (rail + channel sidebar).
export const Route = createFileRoute("/website/skills")({
  component: SkillsView,
});
