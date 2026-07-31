import { CaretRight, Plus } from "@phosphor-icons/react";
import type {
  McpGatewayMemberSummary,
  McpGatewayServer,
  McpServiceAccount,
} from "@posthog/api-client/posthog-client";
import {
  agentHandlePreview,
  formatAgo,
} from "@posthog/core/mcp-gateway/gatewayServers";
import {
  gatewayUserName,
  RobotAvatar,
  UserAvatar,
} from "@posthog/ui/features/mcp-gateway/components/parts/avatars";
import { NewTokenDialog } from "@posthog/ui/features/mcp-gateway/components/parts/NewTokenDialog";
import type { GatewayRoute } from "@posthog/ui/features/mcp-gateway/gatewayRoute";
import { useGatewayMembers } from "@posthog/ui/features/mcp-gateway/hooks/useGatewayMembers";
import { useGatewayServers } from "@posthog/ui/features/mcp-gateway/hooks/useGatewayServers";
import { useServiceAccounts } from "@posthog/ui/features/mcp-gateway/hooks/useServiceAccounts";
import { Badge, Button, Flex, Switch, Text, TextField } from "@radix-ui/themes";
import { useState } from "react";

/** Admin roster: agent service accounts first, then members. */
export function GatewayTeamView({
  onNavigate,
}: {
  onNavigate: (route: GatewayRoute) => void;
}) {
  const { servers } = useGatewayServers();
  const serviceAccounts = useServiceAccounts();
  const { members } = useGatewayMembers({ enabled: true });
  const [creating, setCreating] = useState(false);

  return (
    <Flex direction="column" gap="4" className="min-w-0">
      <Flex direction="column" gap="1">
        <Text className="font-bold text-[28px] leading-tight">
          Team & agents
        </Text>
        <Text color="gray" className="max-w-[560px] text-sm">
          Everyone that reaches your servers through the gateway — people first,
          then agents. Click into anyone to control exactly what they can touch.
        </Text>
      </Flex>

      {creating && (
        <CreateAgentForm
          pending={serviceAccounts.createPending}
          onCreate={(name) =>
            serviceAccounts.createAccount(
              { name },
              {
                onSuccess: (account) => {
                  setCreating(false);
                  onNavigate({ view: "agent", accountId: account.id });
                },
              },
            )
          }
          onCancel={() => setCreating(false)}
        />
      )}

      <Flex align="center" gap="2">
        <Text className="font-medium text-base">Agents</Text>
        <Badge color="gray" variant="soft" size="1">
          {serviceAccounts.accounts.length}
        </Badge>
        {!creating && (
          <Button
            variant="ghost"
            color="gray"
            size="1"
            className="ml-auto"
            onClick={() => setCreating(true)}
          >
            <Plus size={12} /> New agent
          </Button>
        )}
      </Flex>
      <Flex direction="column" gap="2">
        {serviceAccounts.accounts.map((account) => (
          <AgentCard
            key={account.id}
            account={account}
            servers={servers}
            onOpen={() => onNavigate({ view: "agent", accountId: account.id })}
            onToggleStatus={(paused) =>
              serviceAccounts.setStatus({
                accountId: account.id,
                name: account.name,
                status: paused ? "paused" : "active",
              })
            }
          />
        ))}
        {serviceAccounts.accounts.length === 0 && (
          <Text color="gray" className="px-1 text-[13px] italic">
            No agents yet. Create one to give an AI agent its own identity and
            share servers with it.
          </Text>
        )}
      </Flex>

      <Flex align="center" gap="2" mt="2">
        <Text className="font-medium text-base">Members</Text>
        <Badge color="gray" variant="soft" size="1">
          {members.length}
        </Badge>
      </Flex>
      <div className="rounded-[10px] border border-gray-5">
        {members.map((member) => (
          <MemberRow
            key={member.user.id}
            member={member}
            serverCount={servers.length}
            onOpen={() =>
              onNavigate({ view: "member", userId: member.user.id })
            }
          />
        ))}
        {members.length === 0 && (
          <Text color="gray" className="block px-3 py-3 text-[13px] italic">
            No members found.
          </Text>
        )}
      </div>

      <NewTokenDialog
        account={serviceAccounts.newToken}
        onClose={serviceAccounts.dismissNewToken}
      />
    </Flex>
  );
}

function CreateAgentForm({
  pending,
  onCreate,
  onCancel,
}: {
  pending: boolean;
  onCreate: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const handle = agentHandlePreview(name);

  return (
    <Flex
      direction="column"
      gap="2"
      className="rounded-[10px] border border-gray-6 border-dashed p-3"
    >
      <Flex align="end" gap="2">
        <Flex direction="column" gap="1" className="flex-1">
          <Text color="gray" className="font-medium text-xs">
            Agent name
          </Text>
          <TextField.Root
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Docs Agent"
            autoFocus
          />
        </Flex>
        <Button
          variant="solid"
          disabled={!handle || pending}
          onClick={() => onCreate(name.trim())}
        >
          <Plus size={12} weight="bold" /> Create
        </Button>
        <Button variant="soft" color="gray" onClick={onCancel}>
          Cancel
        </Button>
      </Flex>
      <Text color="gray" className="text-xs">
        {handle ? (
          <>
            Will authenticate as{" "}
            <span className="font-mono font-semibold">{handle}</span> — share
            servers with it on the next screen.
          </>
        ) : (
          "The agent signs in with a generated svc-… identity."
        )}
      </Text>
    </Flex>
  );
}

function AgentCard({
  account,
  servers,
  onOpen,
  onToggleStatus,
}: {
  account: McpServiceAccount;
  servers: McpGatewayServer[];
  onOpen: () => void;
  onToggleStatus: (paused: boolean) => void;
}) {
  const active = account.status === "active";
  const toolCount = servers
    .filter((server) => account.server_ids.includes(server.id))
    .reduce((total, server) => total + server.tool_count, 0);
  const lastCall = formatAgo(account.last_active_at);

  return (
    <div className="relative rounded-[10px] border border-gray-5 bg-gray-1 transition-shadow hover:border-gray-7 hover:shadow-sm">
      <button
        type="button"
        onClick={onOpen}
        className="grid w-full grid-cols-[40px_1fr] items-center gap-3 p-3 pr-[180px] text-left"
      >
        <RobotAvatar size="lg" />
        <Flex direction="column" className="min-w-0">
          <Text truncate className="font-semibold text-sm">
            {account.name}
          </Text>
          <Text color="gray" className="text-xs">
            {account.server_ids.length} server
            {account.server_ids.length === 1 ? "" : "s"} · {toolCount} tools
          </Text>
        </Flex>
      </button>
      <div className="-translate-y-1/2 absolute top-1/2 right-3 flex flex-col items-end gap-1">
        <Switch
          size="1"
          checked={active}
          onCheckedChange={(checked) => onToggleStatus(!checked)}
        />
        <Text color="gray" className="text-[11px]">
          {active
            ? lastCall
              ? `last call ${lastCall}`
              : "No calls yet"
            : "Paused — all access off"}
        </Text>
      </div>
    </div>
  );
}

function MemberRow({
  member,
  serverCount,
  onOpen,
}: {
  member: McpGatewayMemberSummary;
  serverCount: number;
  onOpen: () => void;
}) {
  const allowed = serverCount - member.revoked_server_ids.length;
  const connected = member.connected_server_ids.length;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="grid w-full grid-cols-[26px_1fr_auto_auto_auto] items-center gap-3 border-gray-5 border-b px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-gray-2"
    >
      <UserAvatar user={member.user} />
      <Flex direction="column" className="min-w-0">
        <Text truncate className="font-medium text-sm">
          {gatewayUserName(member.user)}
        </Text>
        <Text color="gray" truncate className="text-xs">
          {member.user.email}
        </Text>
      </Flex>
      <Text color="gray" className="text-xs">
        {member.is_org_admin ? "admin" : "member"}
      </Text>
      <Text color="gray" className="text-xs">
        {allowed} of {serverCount} servers
        {connected ? ` · ${connected} connected` : ""}
      </Text>
      <CaretRight size={12} className="text-gray-10" />
    </button>
  );
}
