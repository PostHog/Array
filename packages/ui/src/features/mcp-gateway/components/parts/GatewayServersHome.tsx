import { Check, Gear, Key, MagnifyingGlass, Plus } from "@phosphor-icons/react";
import type {
  McpGatewayServer,
  McpRecommendedServer,
} from "@posthog/api-client/posthog-client";
import { MCP_CATEGORIES } from "@posthog/api-client/posthog-client";
import {
  countGatewayServersByCategory,
  filterGatewayServers,
} from "@posthog/core/mcp-gateway/gatewayServers";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@posthog/quill";
import {
  AvatarStack,
  gatewayUserName,
  UserAvatar,
} from "@posthog/ui/features/mcp-gateway/components/parts/avatars";
import type { GatewayRoute } from "@posthog/ui/features/mcp-gateway/gatewayRoute";
import { useGatewayServers } from "@posthog/ui/features/mcp-gateway/hooks/useGatewayServers";
import { ServerIcon } from "@posthog/ui/features/mcp-servers/components/parts/icons";
import {
  Badge,
  Button,
  Flex,
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
  const categoryCounts = useMemo(
    () => countGatewayServersByCategory(servers),
    [servers],
  );

  return (
    <Flex direction="column" gap="4" className="min-w-0">
      <Flex align="start" justify="between" gap="3">
        <Flex direction="column" gap="1">
          <Text className="font-bold text-[28px] leading-tight">Servers</Text>
          <Text color="gray" className="max-w-[560px] text-sm">
            {isAdmin
              ? "Every MCP server your team runs through the gateway. Connect your own account, or use a credential your admins share with the whole team."
              : "Browse and connect MCP servers that extend your agent with tools, data and integrations."}
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
        size="3"
      >
        <TextField.Slot>
          <MagnifyingGlass size={14} />
        </TextField.Slot>
      </TextField.Root>

      <Flex gap="2" wrap="wrap">
        {MCP_CATEGORIES.map((entry) => {
          const id = entry.id === "all" ? null : entry.id;
          const active = category === id;
          const count =
            id === null ? servers.length : (categoryCounts[id] ?? 0);
          return (
            <Button
              key={entry.id}
              variant={active ? "solid" : "surface"}
              color={active ? undefined : "gray"}
              size="1"
              radius="full"
              onClick={() => setCategory(id)}
            >
              {entry.label}
              {active && (
                <Badge variant="soft" radius="full" size="1">
                  {count}
                </Badge>
              )}
            </Button>
          );
        })}
      </Flex>

      {serversLoading && servers.length === 0 ? (
        <Flex align="center" justify="center" py="6">
          <Spinner size="2" />
        </Flex>
      ) : filtered.length === 0 ? (
        <Empty className="rounded border border-gray-6 border-dashed py-8">
          <EmptyHeader>
            <EmptyTitle>No servers match.</EmptyTitle>
            <EmptyDescription>
              Try a different search, or ask an admin to add a server.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Flex direction="column" gap="2">
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
  const shared = server.auth_mode === "shared";
  const off = !server.is_team_enabled;
  const personal =
    !!server.your_connection && !server.your_connection.pending_oauth;
  const connectedForYou = personal || (shared && !isAdmin);
  const needsAuth = !shared && !personal && !off;

  return (
    <div
      className={`relative rounded-[10px] border border-gray-5 bg-gray-1 transition-shadow hover:border-gray-7 hover:shadow-sm ${off ? "opacity-60" : ""}`}
    >
      <button
        type="button"
        onClick={onOpen}
        className="grid w-full grid-cols-[42px_1fr] items-center gap-3 p-3 pr-[132px] text-left"
      >
        <ServerIcon
          iconDomain={template?.icon_domain}
          serverUrl={server.url}
          size={42}
        />
        <Flex direction="column" gap="1" className="min-w-0">
          <Flex align="center" gap="2">
            <Text truncate className="font-semibold text-sm">
              {server.name}
            </Text>
            {off ? (
              <Badge color="gray" variant="soft" size="1">
                Off
              </Badge>
            ) : connectedForYou ? (
              <Tooltip
                content={shared && !isAdmin ? "Pre-authorized" : "Connected"}
              >
                <span className="flex h-[14px] w-[14px] items-center justify-center rounded-full bg-(--green-9) text-white">
                  <Check size={9} weight="bold" />
                </span>
              </Tooltip>
            ) : null}
            {!off && shared && isAdmin && (
              <Badge color="gray" variant="soft" size="1">
                <Key size={9} /> Shared
              </Badge>
            )}
          </Flex>
          <Text color="gray" truncate className="text-[12.5px]">
            {server.description || server.url}
          </Text>
          {isAdmin && <CardPeopleRow server={server} off={off} />}
        </Flex>
      </button>
      <div className="-translate-y-1/2 absolute top-1/2 right-3">
        {off ? null : needsAuth ? (
          connecting ? (
            <Button variant="outline" color="gray" size="2" disabled>
              <Spinner size="1" /> Authorizing…
            </Button>
          ) : (
            <Button variant="outline" color="gray" size="2" onClick={onConnect}>
              Connect
            </Button>
          )
        ) : (
          <IconButton
            variant="soft"
            color="gray"
            size="2"
            title="Configure"
            onClick={onOpen}
          >
            <Gear size={13} />
          </IconButton>
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
  if (server.auth_mode === "shared") {
    const manager = server.shared_credential?.managed_by;
    return (
      <Flex align="center" gap="2" className="text-xs">
        {manager && <UserAvatar user={manager} size="sm" />}
        <Text color="gray" className="text-xs">
          {manager ? (
            <span className="font-mono text-[11px]">{manager.email}</span>
          ) : (
            "Shared credential"
          )}{" "}
          · everyone on the team
        </Text>
      </Flex>
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
