import { InboxView } from "@posthog/ui/features/inbox/components/InboxView";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/code/inbox")({
  component: InboxView,
});
