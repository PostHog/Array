import { FolderOpen, Plugs } from "@phosphor-icons/react";
import type { LocalMcpCloudClassification } from "@posthog/core/local-mcp/localMcpImport";
import { Button, Flex, Text } from "@radix-ui/themes";

function transportLabel(server: LocalMcpCloudClassification): string {
  if (server.reason === "reserved_name") return "Reserved name";
  if (server.reason === "stdio_transport") return "Local command";
  if (server.reason === "public_url" || server.reason === "private_url") {
    return "HTTP server";
  }
  return "Unsupported configuration";
}

interface LocalMcpRailSectionProps {
  servers: LocalMcpCloudClassification[];
  search: string;
  onOpenConfig: () => void;
}

/** Local PostHog Code MCP servers shared by local agent adapters. */
export function LocalMcpRailSection({
  servers,
  search,
  onOpenConfig,
}: LocalMcpRailSectionProps) {
  const query = search.trim().toLowerCase();
  const visible = query
    ? servers.filter((server) => server.name.toLowerCase().includes(query))
    : servers;
  if (visible.length === 0 && query) return null;

  return (
    <>
      <Flex
        align="center"
        justify="between"
        px="1"
        pt="4"
        pb="1"
        className="tracking-[0.06em]"
      >
        <Text
          color="gray"
          className="font-medium text-[10px] uppercase leading-none"
          title="MCP servers from ~/.posthog-code/mcp.json on this machine"
        >
          Local
        </Text>
        <Button
          variant="ghost"
          color="gray"
          size="1"
          title="Open local MCP configuration"
          aria-label="Open local MCP configuration"
          onClick={onOpenConfig}
        >
          <FolderOpen size={12} />
        </Button>
      </Flex>
      {visible.map((server) => (
        <div
          key={server.name}
          className="grid grid-cols-[28px_1fr] items-center gap-2 rounded px-2 py-1.5 text-gray-11"
        >
          <Flex
            align="center"
            justify="center"
            className="h-[28px] w-[28px] rounded bg-gray-3"
          >
            <Plugs size={14} />
          </Flex>
          <Flex direction="column" className="min-w-0 leading-[1.2]">
            <Text truncate className="font-medium text-[13px]">
              {server.name}
            </Text>
            <Text color="gray" truncate className="text-[10px] leading-none">
              {transportLabel(server)}
            </Text>
          </Flex>
        </div>
      ))}
      {visible.length === 0 && (
        <Text color="gray" className="px-2 py-1 text-[11px]">
          No local servers configured.
        </Text>
      )}
    </>
  );
}
