import { McpServersView } from "@features/mcp-servers/components/McpServersView";
import { Flex } from "@radix-ui/themes";

/** Wraps McpServersView for the Work mode data-sources screen. */
export function WorkDataSourcesView() {
  return (
    <Flex direction="column" height="100%" className="overflow-hidden">
      <div className="min-h-0 flex-1 overflow-hidden">
        <McpServersView />
      </div>
    </Flex>
  );
}
