import { Check, Prohibit, Shield } from "@phosphor-icons/react";
import type {
  McpApprovalState,
  McpGatewayServer,
  McpResolvedToolPolicy,
  McpServiceAccount,
  McpToolPolicyEntry,
} from "@posthog/api-client/posthog-client";
import { defaultAgentGrantPolicy } from "@posthog/core/mcp-gateway/gatewayServers";
import { RobotAvatar } from "@posthog/ui/features/mcp-gateway/components/parts/avatars";
import { ToolPolicyToggle } from "@posthog/ui/features/mcp-servers/components/parts/ToolPolicyToggle";
import {
  Badge,
  Button,
  Dialog,
  Flex,
  IconButton,
  Select,
  Text,
  Tooltip,
} from "@radix-ui/themes";
import { useMemo, useState } from "react";

interface GiveAccessDialogProps {
  open: boolean;
  server: McpGatewayServer;
  /** Every service account; ones that already have access are filtered out. */
  accounts: McpServiceAccount[];
  /** Team-scope rows, used for tool names and rule locks. */
  toolPolicies: McpResolvedToolPolicy[];
  pending: boolean;
  onClose: () => void;
  onGrant: (accountId: string, policies: McpToolPolicyEntry[]) => void;
}

/** "Share <server> with an agent" — agent picker plus per-tool starting policies. */
export function GiveAccessDialog({
  open,
  server,
  accounts,
  toolPolicies,
  pending,
  onClose,
  onGrant,
}: GiveAccessDialogProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [policyMap, setPolicyMap] = useState<Record<string, McpApprovalState>>(
    {},
  );

  const available = useMemo(() => {
    const withAccess = new Set(
      server.agents.map((agent) => agent.service_account_id),
    );
    return accounts.filter((account) => !withAccess.has(account.id));
  }, [accounts, server.agents]);

  const selected = available.find((account) => account.id === selectedId);

  const policyFor = (toolName: string): McpApprovalState =>
    policyMap[toolName] ?? defaultAgentGrantPolicy(toolName);

  const setToolPolicy = (toolName: string, state: McpApprovalState) =>
    setPolicyMap((map) => ({ ...map, [toolName]: state }));

  const bulkSet = (state: McpApprovalState) =>
    setPolicyMap((map) => {
      const next = { ...map };
      for (const policy of toolPolicies) {
        if (policy.decided_by !== "rule") next[policy.tool_name] = state;
      }
      return next;
    });

  const grant = () => {
    if (!selected) return;
    const policies = toolPolicies
      .filter((policy) => policy.decided_by !== "rule")
      .map((policy) => ({
        tool_name: policy.tool_name,
        policy_state: policyFor(policy.tool_name),
      }));
    onGrant(selected.id, policies);
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <Dialog.Content maxWidth="440px">
        <Dialog.Title>Share {server.name} with an agent</Dialog.Title>
        <Dialog.Description color="gray" className="text-sm">
          You're granting this from your admin account. The agent calls{" "}
          {server.name} as itself, under the tool policies you set below.
        </Dialog.Description>

        <Flex direction="column" gap="3" mt="4">
          <Select.Root
            value={selectedId ?? undefined}
            onValueChange={setSelectedId}
          >
            <Select.Trigger placeholder="Choose an agent…" />
            <Select.Content>
              {available.map((account) => (
                <Select.Item key={account.id} value={account.id}>
                  {account.name}{" "}
                  <span className="font-mono text-xs">{account.handle}</span>
                  {account.status === "paused" ? " (paused)" : ""}
                </Select.Item>
              ))}
              {available.length === 0 && (
                <Text color="gray" className="block px-3 py-2 text-sm italic">
                  Every agent already has access to {server.name}.
                </Text>
              )}
            </Select.Content>
          </Select.Root>

          {selected && (
            <Flex direction="column" gap="2">
              <Flex align="center" justify="between">
                <Flex align="center" gap="2">
                  <RobotAvatar size="sm" />
                  <Text
                    color="gray"
                    className="font-medium text-[10px] uppercase tracking-[0.06em]"
                  >
                    Tool policy for {selected.name}
                  </Text>
                </Flex>
                <Flex align="center" gap="1">
                  <Text color="gray" className="text-xs">
                    Set all
                  </Text>
                  <Tooltip content="Auto-approve all">
                    <IconButton
                      variant="soft"
                      color="green"
                      size="1"
                      onClick={() => bulkSet("approved")}
                    >
                      <Check size={11} weight="bold" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip content="Require approval for all">
                    <IconButton
                      variant="soft"
                      color="amber"
                      size="1"
                      onClick={() => bulkSet("needs_approval")}
                    >
                      <Shield size={11} weight="bold" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip content="Block all">
                    <IconButton
                      variant="soft"
                      color="red"
                      size="1"
                      onClick={() => bulkSet("do_not_use")}
                    >
                      <Prohibit size={11} weight="bold" />
                    </IconButton>
                  </Tooltip>
                </Flex>
              </Flex>
              <div className="max-h-[280px] overflow-y-auto rounded border border-gray-5">
                {toolPolicies.map((policy) => (
                  <Flex
                    key={policy.tool_name}
                    align="center"
                    justify="between"
                    gap="3"
                    className="border-gray-5 border-b px-3 py-1.5 last:border-b-0"
                  >
                    <Text truncate className="text-[12.5px]">
                      {policy.tool_name}
                    </Text>
                    {policy.decided_by === "rule" ? (
                      <Badge color="gray" variant="soft" size="1">
                        {policy.policy_state === "do_not_use"
                          ? "Blocked"
                          : "Approval required"}{" "}
                        by team policy
                      </Badge>
                    ) : (
                      <ToolPolicyToggle
                        value={policyFor(policy.tool_name)}
                        onChange={(state) =>
                          setToolPolicy(policy.tool_name, state)
                        }
                      />
                    )}
                  </Flex>
                ))}
                {toolPolicies.length === 0 && (
                  <Text color="gray" className="block px-3 py-2 text-sm italic">
                    No tools discovered yet — the agent gets access as soon as
                    tools appear.
                  </Text>
                )}
              </div>
            </Flex>
          )}
        </Flex>

        <Flex gap="3" mt="4" justify="end">
          <Button variant="soft" color="gray" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="solid"
            disabled={!selected || pending}
            onClick={grant}
          >
            <Check size={12} weight="bold" /> Share access
          </Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
