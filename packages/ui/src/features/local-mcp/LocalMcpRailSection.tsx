import { Plugs } from "@phosphor-icons/react";
import type { LocalMcpCloudClassification } from "@posthog/core/local-mcp/localMcpImport";
import { MCP_RELAY_FLAG } from "@posthog/shared";
import { Flex, Text } from "@radix-ui/themes";
import { useFeatureFlag } from "../feature-flags/useFeatureFlag";

const AVAILABILITY_LABELS: Record<
  LocalMcpCloudClassification["availability"],
  string
> = {
  importable: "Available in cloud",
  requires_desktop: "Requires your machine",
  built_in: "Built into cloud runs",
  unsupported: "Not available in cloud",
};

/** With the relay enabled, desktop-only servers ride along via this machine. */
const RELAY_AVAILABILITY_LABELS: Record<
  LocalMcpCloudClassification["availability"],
  string
> = {
  ...AVAILABILITY_LABELS,
  requires_desktop: "Relayed via your machine",
};

interface LocalMcpRailSectionProps {
  servers: LocalMcpCloudClassification[];
  search: string;
}

/**
 * Rail section listing the user's local (~/.claude.json) MCP servers and
 * whether each will be available inside cloud task runs. Purely
 * informational: these servers are configured outside the app, so the rows
 * open no detail view.
 */
export function LocalMcpRailSection({
  servers,
  search,
}: LocalMcpRailSectionProps) {
  const relayEnabled = useFeatureFlag(MCP_RELAY_FLAG);
  const labels = relayEnabled ? RELAY_AVAILABILITY_LABELS : AVAILABILITY_LABELS;
  const query = search.trim().toLowerCase();
  const visible = query
    ? servers.filter((server) => server.name.toLowerCase().includes(query))
    : servers;
  if (visible.length === 0) return null;

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
          title="MCP servers from ~/.claude.json on this machine"
        >
          Local
        </Text>
        <Text
          color="gray"
          className="rounded-[10px] bg-(--gray-4) px-[6px] py-[1px] text-[10px] leading-none"
        >
          {visible.length}
        </Text>
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
              {labels[server.availability]}
            </Text>
          </Flex>
        </div>
      ))}
    </>
  );
}
