import {
  ArrowClockwise,
  ArrowLeft,
  ArrowUpRight,
  Check,
  Key,
  MagnifyingGlass,
  Plus,
  Prohibit,
  Robot,
  Shield,
  Trash,
  User,
  Users,
  X,
} from "@phosphor-icons/react";
import type {
  McpApprovalState,
  McpGatewayServer,
} from "@posthog/api-client/posthog-client";
import {
  countPoliciesByState,
  formatAgo,
  getGatewayServerRemovalAction,
} from "@posthog/core/mcp-gateway/gatewayServers";
import {
  gatewayUserName,
  RobotAvatar,
  UserAvatar,
} from "@posthog/ui/features/mcp-gateway/components/parts/avatars";
import { GatewayDeleteServerDialog } from "@posthog/ui/features/mcp-gateway/components/parts/GatewayDeleteServerDialog";
import { GatewayToolRow } from "@posthog/ui/features/mcp-gateway/components/parts/GatewayToolRow";
import { GiveAccessDialog } from "@posthog/ui/features/mcp-gateway/components/parts/GiveAccessDialog";
import type { GatewayRoute } from "@posthog/ui/features/mcp-gateway/gatewayRoute";
import {
  type GatewayPolicyScope,
  TEAM_SCOPE,
  YOU_SCOPE,
} from "@posthog/ui/features/mcp-gateway/hooks/gatewayKeys";
import { useGatewayMembers } from "@posthog/ui/features/mcp-gateway/hooks/useGatewayMembers";
import { useGatewayServers } from "@posthog/ui/features/mcp-gateway/hooks/useGatewayServers";
import { useGatewayToolPolicies } from "@posthog/ui/features/mcp-gateway/hooks/useGatewayToolPolicies";
import { useServiceAccounts } from "@posthog/ui/features/mcp-gateway/hooks/useServiceAccounts";
import { ServerIcon } from "@posthog/ui/features/mcp-servers/components/parts/icons";
import { toast } from "@posthog/ui/primitives/toast";
import {
  Badge,
  Button,
  Flex,
  IconButton,
  Separator,
  Spinner,
  Switch,
  Text,
  TextField,
  Tooltip,
} from "@radix-ui/themes";
import { useMemo, useState } from "react";

const TOOL_PREVIEW_LIMIT = 10;

interface GatewayServerDetailProps {
  serverId: string;
  initialScope?: GatewayPolicyScope;
  isAdmin: boolean;
  onNavigate: (route: GatewayRoute) => void;
}

function sameScope(a: GatewayPolicyScope, b: GatewayPolicyScope): boolean {
  return (
    a.scopeType === b.scopeType &&
    a.scopeUserId === b.scopeUserId &&
    a.scopeServiceAccountId === b.scopeServiceAccountId
  );
}

export function GatewayServerDetail({
  serverId,
  initialScope,
  isAdmin,
  onNavigate,
}: GatewayServerDetailProps) {
  const gateway = useGatewayServers();
  const server = gateway.servers.find((entry) => entry.id === serverId);
  const [scope, setScope] = useState<GatewayPolicyScope>(
    initialScope ?? YOU_SCOPE,
  );
  const [giveAccessOpen, setGiveAccessOpen] = useState(false);
  const [deleteServerOpen, setDeleteServerOpen] = useState(false);
  const [toolSearch, setToolSearch] = useState("");
  const [toolsExpanded, setToolsExpanded] = useState(false);

  const tools = useGatewayToolPolicies(serverId, scope, {
    enabled: !!server,
  });
  const filteredPolicies = useMemo(() => {
    const search = toolSearch.trim().toLowerCase();
    if (!search) return tools.policies;
    return tools.policies.filter((policy) =>
      policy.tool_name.toLowerCase().includes(search),
    );
  }, [toolSearch, tools.policies]);
  const displayedPolicies = toolsExpanded
    ? filteredPolicies
    : filteredPolicies.slice(0, TOOL_PREVIEW_LIMIT);
  // Team-scope rows seed the give-access dialog's per-tool defaults.
  const teamTools = useGatewayToolPolicies(serverId, TEAM_SCOPE, {
    enabled: !!server && isAdmin,
  });
  const members = useGatewayMembers({ enabled: isAdmin });
  const serviceAccounts = useServiceAccounts();

  const scopes = useMemo<GatewayPolicyScope[]>(() => {
    if (!server || !isAdmin) return [];
    const list: GatewayPolicyScope[] = [TEAM_SCOPE, YOU_SCOPE];
    if (
      initialScope?.scopeType === "member" &&
      initialScope.scopeUserId !== undefined
    ) {
      list.push(initialScope);
    }
    for (const agent of server.agents) {
      list.push({
        scopeType: "agent",
        scopeServiceAccountId: agent.service_account_id,
        label: agent.name,
      });
    }
    return list;
  }, [server, isAdmin, initialScope]);

  if (!server) {
    return (
      <Flex direction="column" gap="4">
        <BackButton onNavigate={onNavigate} />
        <Flex align="center" justify="center" py="6">
          {gateway.serversLoading ? (
            <Spinner size="2" />
          ) : (
            <Text color="gray" className="text-sm">
              Server not found.
            </Text>
          )}
        </Flex>
      </Flex>
    );
  }

  const shared = server.auth_mode === "shared";
  const yourConnection = server.your_connection;
  const personal = yourConnection?.scope === "personal";
  const selfEnabled = yourConnection ? yourConnection.is_enabled : true;
  const needsReconnect =
    !!yourConnection &&
    (yourConnection.needs_reauth || yourConnection.pending_oauth);
  const connecting = gateway.connectingServerId === server.id;
  const template = server.template_id
    ? gateway.templatesById.get(server.template_id)
    : undefined;
  const serverRemovalAction = getGatewayServerRemovalAction(server, isAdmin);
  const deletesForEveryone = serverRemovalAction === "delete_for_everyone";
  const deleteInstallationId =
    serverRemovalAction === "delete_for_you"
      ? (yourConnection?.installation_id ?? null)
      : null;

  const counts = countPoliciesByState(tools.policies);
  const editableCount = tools.policies.filter(
    (policy) => !policy.locked,
  ).length;
  const filteredEditablePolicies = filteredPolicies.filter(
    (policy) => !policy.locked,
  );
  const hasToolSearch = toolSearch.trim().length > 0;
  const bulkEditableCount = hasToolSearch
    ? filteredEditablePolicies.length
    : editableCount;
  const scopeEditable = isAdmin || editableCount > 0;
  // Refreshing tools needs a live installation to ask the upstream server.
  const refreshInstallationId =
    yourConnection?.installation_id ??
    server.shared_credential?.installation_id ??
    null;

  const setBulkPolicy = (state: McpApprovalState) => {
    tools.setAll(
      state,
      hasToolSearch
        ? filteredEditablePolicies.map((policy) => policy.tool_name)
        : undefined,
    );
  };

  const connectButton = connecting ? (
    <Button variant="solid" size="2" disabled>
      <Spinner size="1" /> Authorizing…
    </Button>
  ) : needsReconnect ? (
    <Button
      variant="solid"
      size="2"
      onClick={() =>
        gateway.reconnect({
          installationId: yourConnection.installation_id,
          serverName: server.name,
        })
      }
      disabled={gateway.reconnectPending}
    >
      <Key size={12} /> Reconnect your account
    </Button>
  ) : (
    <Button variant="solid" size="2" onClick={() => gateway.connect(server)}>
      <Key size={12} />{" "}
      {shared ? "Connect personal account" : "Connect your account"}
    </Button>
  );

  return (
    <Flex direction="column" gap="4" className="min-w-0">
      <BackButton onNavigate={onNavigate} />

      {/* Hero */}
      <Flex align="start" gap="3">
        <ServerIcon
          iconDomain={template?.icon_domain}
          serverUrl={server.url}
          size={56}
        />
        <Flex direction="column" gap="1" className="min-w-0 flex-1">
          <Flex align="center" gap="2">
            <Text truncate className="font-bold text-xl">
              {server.name}
            </Text>
            {shared && isAdmin && (
              <Badge color="gray" variant="soft" size="1">
                <Key size={10} /> Shared credential
              </Badge>
            )}
            {isAdmin && !server.is_team_enabled && (
              <Badge color="gray" variant="soft" size="1">
                Off
              </Badge>
            )}
          </Flex>
          {server.description && (
            <Text color="gray" className="text-sm">
              {server.description}
            </Text>
          )}
          <Flex gap="3" align="center" mt="1">
            {server.created_by && (
              <Text color="gray" className="flex items-center gap-1 text-xs">
                <User size={12} /> {gatewayUserName(server.created_by)}
              </Text>
            )}
            {server.docs_url && (
              <a
                href={server.docs_url}
                target="_blank"
                rel="noreferrer noopener"
                className="flex items-center gap-1 text-accent-11 text-xs hover:underline"
              >
                <ArrowUpRight size={11} /> Docs
              </a>
            )}
          </Flex>
        </Flex>
        <Flex direction="column" align="end" gap="2" className="shrink-0">
          {(deletesForEveryone || deleteInstallationId) && (
            <Tooltip content="Delete server">
              <IconButton
                variant="ghost"
                color="red"
                size="2"
                aria-label="Delete server"
                onClick={() => setDeleteServerOpen(true)}
              >
                <Trash size={14} />
              </IconButton>
            </Tooltip>
          )}
          {!isAdmin && shared && yourConnection && (
            <Tooltip
              content={
                selfEnabled
                  ? "Disable this server for you"
                  : "Enable this server for you"
              }
            >
              <Switch
                size="1"
                checked={selfEnabled}
                onCheckedChange={(enabled) =>
                  gateway.toggleYourConnection({
                    installationId: yourConnection.installation_id,
                    enabled,
                  })
                }
              />
            </Tooltip>
          )}
          {!shared &&
            (yourConnection ? (
              <Flex direction="column" align="end" gap="2">
                {!deletesForEveryone && !deleteInstallationId && (
                  <Button
                    variant="ghost"
                    color="gray"
                    size="2"
                    disabled={gateway.disconnectPending}
                    onClick={() =>
                      gateway.disconnect({
                        installationId: yourConnection.installation_id,
                        serverName: server.name,
                      })
                    }
                  >
                    <X size={12} /> Disconnect
                  </Button>
                )}
                {needsReconnect && connectButton}
              </Flex>
            ) : (
              connectButton
            ))}
          {shared &&
            !isAdmin &&
            server.allow_personal_connections &&
            (personal && !needsReconnect ? (
              <Button
                variant="ghost"
                color="gray"
                size="2"
                onClick={() =>
                  gateway.disconnect({
                    installationId: yourConnection.installation_id,
                    serverName: server.name,
                  })
                }
              >
                <X size={12} /> Disconnect personal account
              </Button>
            ) : (
              connectButton
            ))}
        </Flex>
      </Flex>

      <Separator size="4" />

      {/* Member on a shared server: credential state card */}
      {!isAdmin && shared && (
        <Flex
          align="start"
          gap="3"
          className="rounded-md border border-(--accent-6) bg-(--accent-2) p-3"
        >
          <Flex
            align="center"
            justify="center"
            className="h-[32px] w-[32px] shrink-0 rounded-full bg-(--accent-4) text-accent-11"
          >
            <Key size={15} />
          </Flex>
          <Flex direction="column" gap="1">
            <Text className="font-medium text-sm">
              {!selfEnabled
                ? "Disabled for you"
                : personal
                  ? "Connected with your personal account"
                  : "Pre-authorized for you"}
            </Text>
            <Text color="gray" className="text-[13px]">
              {!selfEnabled
                ? `${server.name} tools won't be offered to you until you turn it back on.`
                : personal
                  ? `Your calls use your own ${server.name} credential instead of the team one.`
                  : `Your admins share one credential with the whole team — nothing to set up.${
                      server.allow_personal_connections
                        ? " Prefer your own account? Connect personally above."
                        : ""
                    }`}
            </Text>
          </Flex>
        </Flex>
      )}

      {isAdmin && (
        <AccessSection
          server={server}
          gateway={gateway}
          onShareWithAgent={() => setGiveAccessOpen(true)}
          onRevokeMember={(userId, name) =>
            members.setMemberAccess({
              userId,
              serverId: server.id,
              enabled: false,
              successMessage: `${name} can no longer use ${server.name}`,
            })
          }
          onRevokeAgent={(accountId, name) =>
            serviceAccounts.setAccess({
              accountId,
              serverId: server.id,
              enabled: false,
              successMessage: `${name} no longer has access to ${server.name}`,
            })
          }
        />
      )}

      {/* Tools */}
      <Flex align="center" justify="between" wrap="wrap" gap="2" mt="2">
        <Flex align="center" gap="2">
          <Text className="font-medium text-base">Tools</Text>
          <Badge color="gray" variant="soft" size="1">
            {tools.policies.length}
          </Badge>
          <Flex gap="2">
            {counts.approved > 0 && (
              <Badge color="green" variant="soft" size="1">
                {counts.approved} auto
              </Badge>
            )}
            {counts.needs_approval > 0 && (
              <Badge color="amber" variant="soft" size="1">
                {counts.needs_approval} approval
              </Badge>
            )}
            {counts.do_not_use > 0 && (
              <Badge color="red" variant="soft" size="1">
                {counts.do_not_use} blocked
              </Badge>
            )}
          </Flex>
        </Flex>
        {!isAdmin && scopeEditable && (
          <BulkTrio
            label="Set all"
            filtered={hasToolSearch}
            disabled={tools.setAllPending || bulkEditableCount === 0}
            onSet={setBulkPolicy}
          />
        )}
      </Flex>

      {isAdmin && (
        <Flex
          align="center"
          gap="2"
          wrap="wrap"
          className="rounded-md border border-gray-5 bg-gray-2 px-3 py-2"
        >
          <Text color="gray" className="text-xs">
            Policy for
          </Text>
          {scopes.map((entry) => {
            const active = sameScope(entry, scope);
            return (
              <Button
                key={`${entry.scopeType}:${entry.scopeUserId ?? ""}:${entry.scopeServiceAccountId ?? ""}`}
                variant={active ? "solid" : "surface"}
                color={active ? undefined : "gray"}
                size="1"
                radius="full"
                onClick={() => {
                  setScope(entry);
                  setToolsExpanded(false);
                }}
              >
                {entry.scopeType === "agent" ? (
                  <Robot size={11} />
                ) : entry.scopeType === "team" ? (
                  <Users size={11} />
                ) : (
                  <User size={11} />
                )}
                {entry.label}
              </Button>
            );
          })}
          <div className="ml-auto flex items-center gap-1">
            <BulkTrio
              label={`Set all for ${scope.label}`}
              filtered={hasToolSearch}
              disabled={tools.setAllPending || bulkEditableCount === 0}
              onSet={setBulkPolicy}
            />
            {refreshInstallationId && (
              <Tooltip content="Refresh tools from server">
                <IconButton
                  variant="soft"
                  color="gray"
                  size="1"
                  disabled={tools.refreshPending}
                  onClick={() => tools.refresh(refreshInstallationId)}
                >
                  {tools.refreshPending ? (
                    <Spinner size="1" />
                  ) : (
                    <ArrowClockwise size={11} weight="bold" />
                  )}
                </IconButton>
              </Tooltip>
            )}
          </div>
        </Flex>
      )}

      {tools.policies.length > 5 && (
        <TextField.Root
          value={toolSearch}
          onChange={(event) => {
            setToolSearch(event.target.value);
            setToolsExpanded(false);
          }}
          placeholder="Search tools..."
          size="2"
        >
          <TextField.Slot>
            <MagnifyingGlass size={14} />
          </TextField.Slot>
          {toolSearch && (
            <TextField.Slot>
              <IconButton
                variant="ghost"
                size="1"
                aria-label="Clear tool search"
                onClick={() => {
                  setToolSearch("");
                  setToolsExpanded(false);
                }}
              >
                <X size={12} />
              </IconButton>
            </TextField.Slot>
          )}
        </TextField.Root>
      )}

      {tools.policiesLoading && tools.policies.length === 0 ? (
        <Flex align="center" justify="center" py="6">
          <Spinner size="2" />
        </Flex>
      ) : tools.policies.length === 0 ? (
        <Flex
          direction="column"
          align="center"
          gap="1"
          py="6"
          className="rounded border border-gray-6 border-dashed"
        >
          <Text className="font-medium text-sm">No tools discovered yet.</Text>
          <Text color="gray" className="text-[13px]">
            Connect the server, then refresh its tools.
          </Text>
        </Flex>
      ) : filteredPolicies.length === 0 ? (
        <Flex align="center" justify="center" py="4">
          <Text color="gray" className="text-sm">
            No tools match &ldquo;{toolSearch}&rdquo;
          </Text>
        </Flex>
      ) : (
        <Flex direction="column" gap="2">
          {displayedPolicies.map((policy) => (
            <GatewayToolRow
              key={policy.tool_name}
              policy={policy}
              editable={scopeEditable && !policy.locked}
              onChange={(state) =>
                tools.setPolicy({ toolName: policy.tool_name, state })
              }
            />
          ))}
          {filteredPolicies.length > TOOL_PREVIEW_LIMIT && (
            <button
              type="button"
              className="w-full px-3 py-2 text-center font-medium text-gray-11 text-xs transition-colors hover:bg-gray-2 hover:text-gray-12"
              onClick={() => setToolsExpanded((expanded) => !expanded)}
            >
              {toolsExpanded ? "View less" : "View more"}
            </button>
          )}
        </Flex>
      )}

      <GiveAccessDialog
        open={giveAccessOpen}
        server={server}
        accounts={serviceAccounts.accounts}
        toolPolicies={teamTools.policies}
        pending={serviceAccounts.setAccessPending}
        onClose={() => setGiveAccessOpen(false)}
        onGrant={(accountId, policies) => {
          const account = serviceAccounts.accounts.find(
            (entry) => entry.id === accountId,
          );
          serviceAccounts.setAccess(
            {
              accountId,
              serverId: server.id,
              enabled: true,
              policies,
              successMessage: `${account?.name ?? "Agent"} can now use ${server.name}`,
            },
            { onSuccess: () => setGiveAccessOpen(false) },
          );
        }}
      />
      <GatewayDeleteServerDialog
        open={deleteServerOpen}
        serverName={server.name}
        deletesForEveryone={deletesForEveryone}
        pending={
          deletesForEveryone
            ? gateway.removeServerPending
            : gateway.disconnectPending
        }
        onOpenChange={setDeleteServerOpen}
        onConfirm={() => {
          if (deletesForEveryone) {
            gateway.removeServer(
              { serverId: server.id, serverName: server.name },
              { onSuccess: () => onNavigate({ view: "servers" }) },
            );
            return;
          }
          if (!deleteInstallationId) return;
          gateway.disconnect(
            {
              installationId: deleteInstallationId,
              serverName: server.name,
              action: "delete",
            },
            {
              onSuccess: () => onNavigate({ view: "servers" }),
            },
          );
        }}
      />
    </Flex>
  );
}

function BackButton({
  onNavigate,
}: {
  onNavigate: (route: GatewayRoute) => void;
}) {
  return (
    <Flex align="center" gap="2">
      <Button
        variant="ghost"
        color="gray"
        size="1"
        onClick={() => onNavigate({ view: "servers" })}
      >
        <ArrowLeft size={12} />
        Back to servers
      </Button>
    </Flex>
  );
}

function BulkTrio({
  label,
  filtered,
  disabled,
  onSet,
}: {
  label: string;
  filtered?: boolean;
  disabled: boolean;
  onSet: (state: McpApprovalState) => void;
}) {
  return (
    <Flex align="center" gap="1">
      <Text color="gray" className="text-xs">
        {label}
      </Text>
      <Tooltip
        content={filtered ? "Auto-approve filtered" : "Auto-approve all"}
      >
        <IconButton
          variant="soft"
          color="green"
          size="1"
          disabled={disabled}
          onClick={() => onSet("approved")}
        >
          <Check size={11} weight="bold" />
        </IconButton>
      </Tooltip>
      <Tooltip
        content={
          filtered
            ? "Require approval for filtered"
            : "Require approval for all"
        }
      >
        <IconButton
          variant="soft"
          color="amber"
          size="1"
          disabled={disabled}
          onClick={() => onSet("needs_approval")}
        >
          <Shield size={11} weight="bold" />
        </IconButton>
      </Tooltip>
      <Tooltip content={filtered ? "Block filtered" : "Block all"}>
        <IconButton
          variant="soft"
          color="red"
          size="1"
          disabled={disabled}
          onClick={() => onSet("do_not_use")}
        >
          <Prohibit size={11} weight="bold" />
        </IconButton>
      </Tooltip>
    </Flex>
  );
}

interface AccessSectionProps {
  server: McpGatewayServer;
  gateway: ReturnType<typeof useGatewayServers>;
  onShareWithAgent: () => void;
  onRevokeMember: (userId: number, firstName: string) => void;
  onRevokeAgent: (accountId: string, name: string) => void;
}

function AccessSection({
  server,
  gateway,
  onShareWithAgent,
  onRevokeMember,
  onRevokeAgent,
}: AccessSectionProps) {
  const shared = server.auth_mode === "shared";
  const yourInstallationId = server.your_connection?.installation_id;

  return (
    <Flex direction="column" gap="2">
      <Text className="font-medium text-base">Access</Text>

      <Flex
        align="center"
        justify="between"
        gap="3"
        className="rounded-md border border-gray-5 p-3"
      >
        <div>
          <Text as="div" className="font-medium text-sm">
            Available to team members
          </Text>
          <Text as="div" color="gray" className="text-[13px]">
            {server.is_team_enabled
              ? shared
                ? `Members use ${server.name} through the shared credential — nothing for them to set up.`
                : `Members can connect their own ${server.name} account.`
              : `Turned off — members can't see or call ${server.name}.`}
          </Text>
        </div>
        <Switch
          checked={server.is_team_enabled}
          onCheckedChange={(enabled) => {
            gateway.updateServer(
              { serverId: server.id, updates: { is_team_enabled: enabled } },
              {
                onSuccess: () => {
                  if (enabled)
                    toast.success(`${server.name} enabled for the team`);
                  else toast.info(`${server.name} disabled`);
                },
              },
            );
          }}
        />
      </Flex>

      {shared && server.shared_credential && (
        <Flex
          align="start"
          gap="3"
          className="rounded-md border border-gray-5 p-3"
        >
          <Flex
            align="center"
            justify="center"
            className="h-[32px] w-[32px] shrink-0 rounded-full bg-gray-3 text-gray-11"
          >
            <Key size={15} />
          </Flex>
          <Flex direction="column" gap="1" className="min-w-0 flex-1">
            <Text className="font-mono text-sm">
              {server.shared_credential.managed_by?.email ??
                "Shared credential"}
            </Text>
            <Text color="gray" className="text-[13px]">
              Shared credential
              {server.shared_credential.managed_by
                ? ` — managed by ${gatewayUserName(server.shared_credential.managed_by)}`
                : ""}
              . Everyone on the team calls {server.name} through this account.
            </Text>
          </Flex>
          <Button
            variant="ghost"
            color="gray"
            size="1"
            disabled={gateway.reconnectPending}
            onClick={() =>
              gateway.reconnect({
                installationId: server.shared_credential
                  ? server.shared_credential.installation_id
                  : "",
                serverName: server.name,
              })
            }
          >
            <ArrowClockwise size={12} /> Rotate
          </Button>
        </Flex>
      )}

      {shared && (
        <Flex
          align="center"
          justify="between"
          gap="3"
          className="rounded-md border border-gray-5 p-3"
        >
          <div>
            <Text as="div" className="font-medium text-sm">
              Personal connections
            </Text>
            <Text as="div" color="gray" className="text-[13px]">
              Let members authenticate their own {server.name} account on top of
              the shared credential.
            </Text>
          </div>
          <Switch
            checked={server.allow_personal_connections}
            onCheckedChange={(allowed) => {
              gateway.updateServer(
                {
                  serverId: server.id,
                  updates: { allow_personal_connections: allowed },
                },
                {
                  onSuccess: () => {
                    if (allowed)
                      toast.success(
                        `Members can now connect personal ${server.name} accounts`,
                      );
                    else
                      toast.info(
                        `Personal connections turned off for ${server.name}`,
                      );
                  },
                },
              );
            }}
          />
        </Flex>
      )}

      <Flex align="center" gap="2" mt="1" className="tracking-[0.06em]">
        <Text
          color="gray"
          className="font-medium text-xs uppercase leading-none"
        >
          People connected
        </Text>
        <Badge color="gray" variant="soft" size="1">
          {server.connections.length}
        </Badge>
      </Flex>
      {server.connections.length === 0 ? (
        <Text color="gray" className="px-1 text-[13px] italic">
          {shared
            ? "No one has connected a personal account — everyone uses the shared credential."
            : "No one has connected yet."}
        </Text>
      ) : (
        <div className="overflow-hidden rounded-md border border-gray-5">
          {server.connections.map((connection) => {
            const isYou = connection.installation_id === yourInstallationId;
            const usedAgo = formatAgo(connection.last_used_at);
            return (
              <Flex
                key={connection.installation_id}
                align="center"
                gap="3"
                className="group border-gray-5 border-b px-3 py-2 last:border-b-0"
              >
                <UserAvatar user={connection.user} />
                <Flex direction="column" className="min-w-0 flex-1">
                  <Flex align="center" gap="2">
                    <Text truncate className="font-medium text-sm">
                      {gatewayUserName(connection.user)}
                    </Text>
                    {isYou && (
                      <Badge
                        color="indigo"
                        variant="soft"
                        size="1"
                        className="px-1 py-0 text-[10px] leading-4"
                      >
                        You
                      </Badge>
                    )}
                  </Flex>
                  <Text color="gray" truncate className="text-xs">
                    {connection.user.email}
                  </Text>
                </Flex>
                {!isYou && (
                  <Button
                    variant="ghost"
                    color="red"
                    size="1"
                    className="opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                    onClick={() =>
                      onRevokeMember(
                        connection.user.id,
                        gatewayUserName(connection.user).split(" ")[0],
                      )
                    }
                  >
                    <X size={11} /> Revoke
                  </Button>
                )}
                <Flex align="center" gap="2" className="shrink-0">
                  <span
                    className={`h-[6px] w-[6px] rounded-full ${
                      connection.needs_reauth
                        ? "bg-(--red-9)"
                        : connection.pending_oauth
                          ? "bg-(--amber-9)"
                          : "bg-(--green-9)"
                    }`}
                  />
                  <Text color="gray" className="text-xs">
                    {connection.needs_reauth
                      ? "Needs reauth"
                      : connection.pending_oauth
                        ? "Finishing setup"
                        : `Connected${usedAgo ? ` · used ${usedAgo}` : ""}`}
                  </Text>
                </Flex>
              </Flex>
            );
          })}
        </div>
      )}

      <Flex align="center" gap="2" mt="4" className="tracking-[0.06em]">
        <Text
          color="gray"
          className="font-medium text-xs uppercase leading-none"
        >
          Agents
        </Text>
        <Badge color="gray" variant="soft" size="1">
          {server.agents.length}
        </Badge>
        <Button
          variant="ghost"
          color="gray"
          size="1"
          className="ml-auto"
          onClick={onShareWithAgent}
        >
          <Plus size={12} /> Share access with an agent
        </Button>
      </Flex>
      {server.agents.length === 0 ? (
        <Text color="gray" className="px-1 text-[13px] italic">
          No agents have access. Sharing from your admin account lets an agent
          call {server.name} under its own tool policies.
        </Text>
      ) : (
        <div className="rounded-md border border-gray-5">
          {server.agents.map((agent) => (
            <Flex
              key={agent.service_account_id}
              align="center"
              gap="3"
              className="group border-gray-5 border-b px-3 py-2 last:border-b-0"
            >
              <RobotAvatar />
              <Flex direction="column" className="min-w-0 flex-1">
                <Text truncate className="font-medium text-sm">
                  {agent.name}
                </Text>
                <Text color="gray" truncate className="text-xs">
                  <span className="font-mono">{agent.handle}</span> · shared
                  from your admin account
                </Text>
              </Flex>
              <Button
                variant="ghost"
                color="red"
                size="1"
                className="opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                onClick={() =>
                  onRevokeAgent(agent.service_account_id, agent.name)
                }
              >
                <X size={11} /> Revoke
              </Button>
              <Flex align="center" gap="2" className="shrink-0">
                <span
                  className={`h-[6px] w-[6px] rounded-full ${
                    agent.status === "active" ? "bg-(--green-9)" : "bg-gray-8"
                  }`}
                />
                <Text color="gray" className="text-xs">
                  {agent.status === "active"
                    ? `Active${
                        formatAgo(agent.last_active_at)
                          ? ` ${formatAgo(agent.last_active_at)}`
                          : ""
                      }`
                    : "Paused"}
                </Text>
              </Flex>
            </Flex>
          ))}
        </div>
      )}
    </Flex>
  );
}
