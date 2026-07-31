import {
  CaretRight,
  Check,
  MagnifyingGlass,
  Plus,
  X,
} from "@phosphor-icons/react";
import type {
  McpGatewayServer,
  McpRecommendedServer,
} from "@posthog/api-client/posthog-client";
import { MCP_CATEGORIES } from "@posthog/api-client/posthog-client";
import {
  filterGatewayServers,
  getGatewayConnectionStatus,
} from "@posthog/core/mcp-gateway/gatewayServers";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@posthog/quill";
import {
  AvatarStack,
  gatewayUserName,
} from "@posthog/ui/features/mcp-gateway/components/parts/avatars";
import type { GatewayRoute } from "@posthog/ui/features/mcp-gateway/gatewayRoute";
import { useGatewayServers } from "@posthog/ui/features/mcp-gateway/hooks/useGatewayServers";
import { ServerIcon } from "@posthog/ui/features/mcp-servers/components/parts/icons";
import {
  Badge,
  Button,
  Flex,
  Heading,
  IconButton,
  Spinner,
  Text,
  TextField,
  Tooltip,
} from "@radix-ui/themes";
import { useMemo, useState } from "react";

interface GatewayServersHomeProps {
  isAdmin: boolean;
  canAddServers: boolean;
  onNavigate: (route: GatewayRoute) => void;
}

export function GatewayServersHome({
  isAdmin,
  canAddServers,
  onNavigate,
}: GatewayServersHomeProps) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const {
    servers,
    serversLoading,
    templatesById,
    connect,
    connectingServerId,
  } = useGatewayServers();

  const filtered = useMemo(
    () => filterGatewayServers(servers, query, category),
    [servers, query, category],
  );
  const hasFilters = query !== "" || category !== null;

  return (
    <Flex direction="column" gap="4" className="min-w-0">
      <Flex align="start" justify="between" gap="3">
        <Flex direction="column" gap="1" className="min-w-0">
          <Heading className="font-bold text-2xl">Servers</Heading>
          <Text color="gray" className="max-w-[560px] text-sm">
            Browse and connect MCP servers that extend your agent with tools,
            data and integrations.
          </Text>
        </Flex>
        {canAddServers && (
          <Button
            variant="solid"
            size="2"
            className="shrink-0"
            onClick={() => onNavigate({ view: "add" })}
          >
            <Plus size={13} weight="bold" /> Add server
          </Button>
        )}
      </Flex>

      <TextField.Root
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search team servers…"
        size="2"
      >
        <TextField.Slot>
          <MagnifyingGlass size={14} />
        </TextField.Slot>
        {query && (
          <TextField.Slot>
            <IconButton
              variant="ghost"
              size="1"
              aria-label="Clear server search"
              onClick={() => setQuery("")}
            >
              <X size={12} />
            </IconButton>
          </TextField.Slot>
        )}
      </TextField.Root>

      <Flex gap="2" wrap="wrap">
        {MCP_CATEGORIES.map((entry) => {
          const id = entry.id === "all" ? null : entry.id;
          const active = category === id;
          return (
            <button
              key={entry.id}
              type="button"
              onClick={() => setCategory(id)}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                active
                  ? "border-accent-8 bg-accent-4 text-accent-11"
                  : "border-gray-5 bg-gray-2 text-gray-11 hover:border-gray-7 hover:bg-gray-3"
              }`}
            >
              {entry.label}
              {active && entry.id !== "all" && (
                <span className="ml-1 text-gray-11">({filtered.length})</span>
              )}
            </button>
          );
        })}
      </Flex>

      <Flex align="center" justify="between">
        <Text color="gray" className="text-[13px]">
          {filtered.length} {filtered.length === 1 ? "server" : "servers"}
        </Text>
        {hasFilters && (
          <Button
            variant="ghost"
            size="1"
            color="gray"
            onClick={() => {
              setQuery("");
              setCategory(null);
            }}
          >
            Clear filters
          </Button>
        )}
      </Flex>

      {serversLoading && servers.length === 0 ? (
        <Flex align="center" justify="center" py="6">
          <Spinner size="2" />
        </Flex>
      ) : filtered.length === 0 ? (
        <Empty className="rounded border border-gray-6 border-dashed py-8">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <MagnifyingGlass size={28} />
            </EmptyMedia>
            <EmptyTitle>No servers match.</EmptyTitle>
            <EmptyDescription>
              Try a different search, or ask an admin to add a server.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Flex direction="column" gap="3">
          {filtered.map((server) => (
            <GatewayServerCard
              key={server.id}
              server={server}
              template={
                server.template_id
                  ? templatesById.get(server.template_id)
                  : undefined
              }
              isAdmin={isAdmin}
              connecting={connectingServerId === server.id}
              onOpen={() => onNavigate({ view: "server", serverId: server.id })}
              onConnect={() => connect(server)}
            />
          ))}
        </Flex>
      )}
    </Flex>
  );
}

function GatewayServerCard({
  server,
  template,
  isAdmin,
  connecting,
  onOpen,
  onConnect,
}: {
  server: McpGatewayServer;
  template: McpRecommendedServer | undefined;
  isAdmin: boolean;
  connecting: boolean;
  onOpen: () => void;
  onConnect: () => void;
}) {
  const off = !server.is_team_enabled;
  const connectedForYou =
    !!server.your_connection &&
    getGatewayConnectionStatus(server.your_connection) === "connected";
  const needsAuth = !connectedForYou && !off;

  return (
    <div
      className={`relative rounded-md border border-gray-5 bg-gray-2 transition-colors hover:border-gray-7 hover:bg-gray-3 ${off ? "opacity-60" : ""}`}
    >
      <button
        type="button"
        onClick={onOpen}
        className="grid w-full grid-cols-[36px_1fr] items-center gap-3 rounded-md p-4 pr-[132px] text-left"
      >
        <ServerIcon
          iconDomain={template?.icon_domain}
          serverUrl={server.url}
          size={36}
        />
        <Flex direction="column" gap="1" className="min-w-0">
          <Flex align="center" gap="2">
            <Text truncate className="font-medium text-base">
              {server.name}
            </Text>
            {off ? (
              <Badge color="gray" variant="soft" size="1">
                Off
              </Badge>
            ) : connectedForYou ? (
              <Tooltip content="Connected">
                <span className="flex h-[14px] w-[14px] items-center justify-center rounded-full bg-(--green-9) text-white">
                  <Check size={9} weight="bold" />
                </span>
              </Tooltip>
            ) : null}
          </Flex>
          <Text
            color="gray"
            style={{
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
            }}
            className="overflow-hidden text-[13px]"
          >
            {server.description || server.url}
          </Text>
          {isAdmin && <CardPeopleRow server={server} off={off} />}
        </Flex>
      </button>
      <div className="absolute top-4 right-4">
        {off ? null : needsAuth ? (
          connecting ? (
            <Button variant="solid" size="1" disabled>
              <Spinner size="1" /> Authorizing…
            </Button>
          ) : (
            <Button variant="solid" size="1" onClick={onConnect}>
              Connect
            </Button>
          )
        ) : (
          <Button
            variant="soft"
            color="gray"
            size="1"
            title="Configure"
            onClick={onOpen}
          >
            Configure
            <CaretRight size={12} />
          </Button>
        )}
      </div>
    </div>
  );
}

function CardPeopleRow({
  server,
  off,
}: {
  server: McpGatewayServer;
  off: boolean;
}) {
  if (off) {
    return (
      <Text color="gray" className="text-xs">
        Disabled — enable it in Team settings
      </Text>
    );
  }
  const connections = server.connections;
  if (connections.length === 0) return null;
  const agentCount = server.agents.length;
  const label =
    connections.length === 1
      ? `${gatewayUserName(connections[0].user).split(" ")[0]} is connected`
      : `${connections.length} teammates connected${
          agentCount ? ` · ${agentCount} agent${agentCount > 1 ? "s" : ""}` : ""
        }`;
  return (
    <Flex align="center" gap="2">
      <AvatarStack users={connections.map((connection) => connection.user)} />
      <Text color="gray" className="text-xs">
        {label}
      </Text>
    </Flex>
  );
}
