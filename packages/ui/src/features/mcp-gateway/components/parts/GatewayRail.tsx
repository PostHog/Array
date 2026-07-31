import {
  Gear,
  Key,
  MagnifyingGlass,
  Plugs,
  Plus,
  Rows,
  Users,
  X,
} from "@phosphor-icons/react";
import type {
  McpGatewayServer,
  McpRecommendedServer,
} from "@posthog/api-client/posthog-client";
import {
  formatAgo,
  partitionRailServers,
} from "@posthog/core/mcp-gateway/gatewayServers";
import type { GatewayRoute } from "@posthog/ui/features/mcp-gateway/gatewayRoute";
import { ServerIcon } from "@posthog/ui/features/mcp-servers/components/parts/icons";
import {
  Flex,
  IconButton,
  ScrollArea,
  Text,
  TextField,
} from "@radix-ui/themes";
import type { ComponentType } from "react";
import { useMemo, useState } from "react";

interface GatewayRailProps {
  servers: McpGatewayServer[];
  templatesById: Map<string, McpRecommendedServer>;
  isAdmin: boolean;
  canAddServers: boolean;
  activeAgentCount: number;
  route: GatewayRoute;
  onNavigate: (route: GatewayRoute) => void;
}

export function GatewayRail({
  servers,
  templatesById,
  isAdmin,
  canAddServers,
  activeAgentCount,
  route,
  onNavigate,
}: GatewayRailProps) {
  const [search, setSearch] = useState("");

  const { yourConnections, sharedWithYou } = useMemo(
    () => partitionRailServers(servers, search),
    [servers, search],
  );

  const activeServerId = route.view === "server" ? route.serverId : null;

  return (
    <aside className="flex h-full min-h-0 w-[256px] shrink-0 flex-col border-gray-6 border-r bg-gray-2">
      <Flex
        align="center"
        justify="between"
        px="3"
        pt="3"
        pb="2"
        className="border-b border-b-(--gray-5)"
      >
        <Text className="font-bold text-sm">Gateway</Text>
        {canAddServers && (
          <IconButton
            variant="ghost"
            color="gray"
            size="1"
            onClick={() => onNavigate({ view: "add" })}
            title="Add server"
          >
            <Plus size={14} />
          </IconButton>
        )}
      </Flex>

      <Flex direction="column" gap="2" px="3" pt="3">
        <TextField.Root
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search servers…"
          size="1"
        >
          <TextField.Slot>
            <MagnifyingGlass size={12} />
          </TextField.Slot>
          {search && (
            <TextField.Slot>
              <IconButton
                variant="ghost"
                size="1"
                onClick={() => setSearch("")}
              >
                <X size={10} />
              </IconButton>
            </TextField.Slot>
          )}
        </TextField.Root>
      </Flex>

      <ScrollArea className="min-h-0 flex-1">
        <Flex direction="column" px="2" pb="3">
          <RailSectionLabel
            label="Your connections"
            count={yourConnections.length}
          />
          {yourConnections.length === 0 ? (
            <Text color="gray" className="px-[10px] py-[6px] text-xs italic">
              Nothing connected yet.
            </Text>
          ) : (
            yourConnections.map((server) => (
              <RailServerRow
                key={server.id}
                server={server}
                templatesById={templatesById}
                active={activeServerId === server.id}
                sub={
                  formatAgo(server.your_connection?.last_used_at ?? null)
                    ? `used ${formatAgo(server.your_connection?.last_used_at ?? null)}`
                    : "Connected"
                }
                onClick={() =>
                  onNavigate({ view: "server", serverId: server.id })
                }
              />
            ))
          )}

          <RailSectionLabel
            label="Shared with you"
            count={sharedWithYou.length}
          />
          {sharedWithYou.map((server) => (
            <RailServerRow
              key={server.id}
              server={server}
              templatesById={templatesById}
              active={activeServerId === server.id}
              sub={
                isAdmin
                  ? (server.shared_credential?.managed_by?.email ??
                    "Shared credential")
                  : "Pre-authorized"
              }
              subMono={isAdmin && !!server.shared_credential?.managed_by}
              shared
              onClick={() =>
                onNavigate({ view: "server", serverId: server.id })
              }
            />
          ))}

          <div className="mx-2 my-3 border-gray-5 border-t" />
          <RailSectionLabel label="Manage" />
          <RailLink
            icon={Plugs}
            label="All servers"
            active={route.view === "servers" || route.view === "server"}
            onClick={() => onNavigate({ view: "servers" })}
          />
          {isAdmin && (
            <RailLink
              icon={Users}
              label="Team & agents"
              active={["team", "agent", "member"].includes(route.view)}
              onClick={() => onNavigate({ view: "team" })}
            />
          )}
          {isAdmin && (
            <RailLink
              icon={Gear}
              label="Team settings"
              active={route.view === "settings"}
              onClick={() => onNavigate({ view: "settings" })}
            />
          )}
          {isAdmin && (
            <RailLink
              icon={Rows}
              label="Audit log"
              active={route.view === "audit"}
              onClick={() => onNavigate({ view: "audit" })}
            />
          )}
        </Flex>
      </ScrollArea>

      <Flex
        align="center"
        gap="2"
        px="3"
        py="2"
        className="border-gray-5 border-t"
      >
        <span className="h-[6px] w-[6px] shrink-0 rounded-full bg-(--green-9)" />
        <Text color="gray" className="truncate text-[11px]">
          Gateway healthy · {activeAgentCount} agent
          {activeAgentCount === 1 ? "" : "s"} active
        </Text>
      </Flex>
    </aside>
  );
}

function RailSectionLabel({ label, count }: { label: string; count?: number }) {
  return (
    <Flex
      align="center"
      justify="between"
      px="2"
      pt="4"
      pb="1"
      className="tracking-[0.06em]"
    >
      <Text
        color="gray"
        className="font-medium text-[10px] uppercase leading-none"
      >
        {label}
      </Text>
      {count !== undefined && (
        <Text
          color="gray"
          className="rounded-[10px] bg-(--gray-4) px-[6px] py-[1px] text-[10px] leading-none"
        >
          {count}
        </Text>
      )}
    </Flex>
  );
}

function RailServerRow({
  server,
  templatesById,
  active,
  sub,
  subMono,
  shared,
  onClick,
}: {
  server: McpGatewayServer;
  templatesById: Map<string, McpRecommendedServer>;
  active: boolean;
  sub: string;
  subMono?: boolean;
  shared?: boolean;
  onClick: () => void;
}) {
  const template = server.template_id
    ? templatesById.get(server.template_id)
    : undefined;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`grid grid-cols-[26px_1fr_auto] items-center gap-2 rounded px-2 py-1.5 text-left transition-colors ${
        active
          ? "bg-gray-1 text-gray-12 shadow-sm"
          : "text-gray-11 hover:bg-gray-3"
      }`}
    >
      <ServerIcon
        iconDomain={template?.icon_domain}
        serverUrl={server.url}
        size={26}
      />
      <Flex direction="column" className="min-w-0 leading-[1.2]">
        <Text truncate className="font-medium text-[12.5px]">
          {server.name}
        </Text>
        <Text
          color="gray"
          truncate
          className={`text-[10px] leading-none ${subMono ? "font-mono" : ""}`}
        >
          {sub}
        </Text>
      </Flex>
      {shared ? (
        <Key size={11} className="text-gray-10" />
      ) : (
        <span
          aria-hidden="true"
          className="h-[6px] w-[6px] rounded-full bg-(--green-9)"
          style={{
            boxShadow:
              "0 0 0 3px color-mix(in oklch, var(--green-9) 20%, transparent)",
          }}
        />
      )}
    </button>
  );
}

function RailLink({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: ComponentType<{ size?: number; className?: string }>;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] transition-colors ${
        active
          ? "bg-gray-1 text-gray-12 shadow-sm"
          : "text-gray-11 hover:bg-gray-3"
      }`}
    >
      <Icon size={14} className={active ? "text-accent-11" : undefined} />
      <span>{label}</span>
    </button>
  );
}
