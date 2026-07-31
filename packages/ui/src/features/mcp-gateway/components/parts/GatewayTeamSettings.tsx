import { Check, MagnifyingGlass, X } from "@phosphor-icons/react";
import type { GatewayRoute } from "@posthog/ui/features/mcp-gateway/gatewayRoute";
import { useGatewayConfig } from "@posthog/ui/features/mcp-gateway/hooks/useGatewayConfig";
import { useGatewayServers } from "@posthog/ui/features/mcp-gateway/hooks/useGatewayServers";
import { ServerIcon } from "@posthog/ui/features/mcp-servers/components/parts/icons";
import { toast } from "@posthog/ui/primitives/toast";
import {
  Button,
  Flex,
  Heading,
  IconButton,
  Separator,
  Switch,
  Text,
  TextField,
} from "@radix-ui/themes";
import { useMemo, useState } from "react";

const SERVER_PREVIEW_LIMIT = 10;

interface GatewayTeamSettingsProps {
  onNavigate: (route: GatewayRoute) => void;
}

/** Admin settings: custom-server gate and server access. */
export function GatewayTeamSettings({ onNavigate }: GatewayTeamSettingsProps) {
  const { allowCustomServers, allowMemberAgentAccess, updateSettings } =
    useGatewayConfig();
  const { servers, updateServer, setAllEnabled } = useGatewayServers();
  const [serverSearch, setServerSearch] = useState("");
  const [serversExpanded, setServersExpanded] = useState(false);

  const enabledCount = servers.filter(
    (server) => server.is_team_enabled,
  ).length;
  const filteredServers = useMemo(() => {
    const search = serverSearch.trim().toLowerCase();
    return [...servers]
      .filter((server) => !search || server.name.toLowerCase().includes(search))
      .sort((first, second) =>
        first.name.localeCompare(second.name, undefined, {
          sensitivity: "base",
        }),
      );
  }, [serverSearch, servers]);
  const displayedServers = serversExpanded
    ? filteredServers
    : filteredServers.slice(0, SERVER_PREVIEW_LIMIT);

  return (
    <Flex direction="column" gap="4" className="min-w-0">
      <Heading className="font-bold text-2xl">Team settings</Heading>

      <Text className="font-medium text-base">Custom servers</Text>
      <Flex
        align="center"
        justify="between"
        gap="3"
        className="rounded-md border border-gray-5 bg-gray-2 p-3"
      >
        <div>
          <Text as="div" className="font-medium text-sm">
            Allow custom servers
          </Text>
          <Text as="div" color="gray" className="text-[13px]">
            Members can add their own MCP servers, the same way admins do.
          </Text>
        </div>
        <Switch
          checked={allowCustomServers}
          onCheckedChange={(allowed) =>
            updateSettings(
              { allow_custom_servers: allowed },
              {
                onSuccess: () => {
                  if (allowed)
                    toast.success("Members can now add custom servers");
                  else toast.info("Custom servers are admin-only again");
                },
              },
            )
          }
        />
      </Flex>

      <Text className="font-medium text-base">Agent access</Text>
      <Flex
        align="center"
        justify="between"
        gap="3"
        className="rounded-md border border-gray-5 bg-gray-2 p-3"
      >
        <div>
          <Text as="div" className="font-medium text-sm">
            Allow members to manage agent access
          </Text>
          <Text as="div" color="gray" className="text-[13px]">
            Members can share connections with agents and choose which tools
            those agents may call. Turn this off to make those controls
            admin-only.
          </Text>
        </div>
        <Switch
          checked={allowMemberAgentAccess}
          onCheckedChange={(allowed) =>
            updateSettings(
              { allow_member_agent_access: allowed },
              {
                onSuccess: () => {
                  if (allowed)
                    toast.success("Members can now manage agent access");
                  else toast.info("Agent access is admin-only again");
                },
              },
            )
          }
        />
      </Flex>

      <Separator size="4" />

      <Text className="font-medium text-base">Server access</Text>
      <Text color="gray" className="text-[13px]">
        Everything is shared with the team by default. Disable everything to
        curate up from zero, or switch off individual servers.
      </Text>
      <Flex align="center" justify="between" gap="2" wrap="wrap">
        <Text color="gray" className="text-[13px]">
          {enabledCount} of {servers.length} servers enabled
        </Text>
        <Flex align="center" gap="2">
          <TextField.Root
            value={serverSearch}
            onChange={(event) => {
              setServerSearch(event.target.value);
              setServersExpanded(false);
            }}
            placeholder="Search servers…"
            size="1"
          >
            <TextField.Slot>
              <MagnifyingGlass size={12} />
            </TextField.Slot>
            {serverSearch && (
              <TextField.Slot>
                <IconButton
                  variant="ghost"
                  size="1"
                  onClick={() => {
                    setServerSearch("");
                    setServersExpanded(false);
                  }}
                >
                  <X size={10} />
                </IconButton>
              </TextField.Slot>
            )}
          </TextField.Root>
          <Button
            variant="ghost"
            color="gray"
            size="1"
            disabled={enabledCount === servers.length}
            onClick={() => setAllEnabled(true)}
          >
            <Check size={12} /> Enable all
          </Button>
          <Button
            variant="ghost"
            color="gray"
            size="1"
            disabled={enabledCount === 0}
            onClick={() => setAllEnabled(false)}
          >
            <X size={12} /> Disable all
          </Button>
        </Flex>
      </Flex>
      <div className="overflow-hidden rounded border border-gray-5 bg-gray-2">
        {displayedServers.map((server) => (
          <Flex
            key={server.id}
            align="center"
            gap="3"
            className={`border-gray-5 border-b px-3 py-2 last:border-b-0 ${server.is_team_enabled ? "" : "opacity-60"}`}
          >
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-3 rounded-sm text-left outline-none hover:text-gray-12 focus-visible:ring-(--focus-8) focus-visible:ring-2"
              onClick={() =>
                onNavigate({ view: "server", serverId: server.id })
              }
            >
              <ServerIcon serverUrl={server.url} size={26} />
              <Flex direction="column" className="min-w-0 flex-1">
                <Text truncate className="font-medium text-sm">
                  {server.name}
                </Text>
                <Text color="gray" className="text-xs">
                  {server.auth_mode === "shared"
                    ? "Shared credential"
                    : "Individual accounts"}
                </Text>
              </Flex>
            </button>
            <Switch
              size="1"
              checked={server.is_team_enabled}
              onCheckedChange={(enabled) =>
                updateServer(
                  {
                    serverId: server.id,
                    updates: { is_team_enabled: enabled },
                  },
                  {
                    onSuccess: () => {
                      if (enabled)
                        toast.success(`${server.name} enabled for the team`);
                      else toast.info(`${server.name} disabled`);
                    },
                  },
                )
              }
            />
          </Flex>
        ))}
        {filteredServers.length === 0 && (
          <Text color="gray" className="block px-3 py-3 text-[13px] italic">
            No servers match &ldquo;{serverSearch}&rdquo;.
          </Text>
        )}
        {filteredServers.length > SERVER_PREVIEW_LIMIT && (
          <button
            type="button"
            className="w-full px-3 py-2 text-center font-medium text-gray-11 text-xs transition-colors hover:bg-gray-3 hover:text-gray-12"
            onClick={() => setServersExpanded((expanded) => !expanded)}
          >
            {serversExpanded ? "View less" : "View more"}
          </button>
        )}
      </div>
    </Flex>
  );
}
