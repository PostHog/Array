import { McpServersView } from "@features/mcp-servers/components/McpServersView";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/mcp-servers")({
  component: McpServersView,
});
