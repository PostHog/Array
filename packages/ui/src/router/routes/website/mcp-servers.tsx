import { McpServersView } from "@posthog/ui/features/mcp-servers/components/McpServersView";
import { createFileRoute } from "@tanstack/react-router";

// Channels-space mirror of /mcp-servers. Renders the same shared McpServersView
// so the page stays single-source; only the route entry is duplicated so
// navigating here keeps the channels chrome (rail + channel sidebar).
export const Route = createFileRoute("/website/mcp-servers")({
  component: McpServersView,
});
