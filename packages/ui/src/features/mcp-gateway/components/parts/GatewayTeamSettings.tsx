import { Check, MagnifyingGlass, X } from "@phosphor-icons/react";
import type { McpPolicyPreset } from "@posthog/api-client/posthog-client";
import { useGatewayConfig } from "@posthog/ui/features/mcp-gateway/hooks/useGatewayConfig";
import { useGatewayRules } from "@posthog/ui/features/mcp-gateway/hooks/useGatewayRules";
import { useGatewayServers } from "@posthog/ui/features/mcp-gateway/hooks/useGatewayServers";
import { ServerIcon } from "@posthog/ui/features/mcp-servers/components/parts/icons";
import { toast } from "@posthog/ui/primitives/toast";
import {
  Badge,
  Button,
  Flex,
  IconButton,
  Separator,
  Switch,
  Text,
  TextField,
} from "@radix-ui/themes";
import { useState } from "react";

const PRESETS: {
  value: McpPolicyPreset;
  label: string;
  hint: string;
  appliedToast: string;
}[] = [
  {
    value: "allow",
    label: "Allow all",
    hint: "Every tool runs without asking",
    appliedToast: "every tool auto-approved",
  },
  {
    value: "user",
    label: "Member decides",
    hint: "Each member sets their own tool approvals",
    appliedToast: "every call asks first",
  },
  {
    value: "ask",
    label: "Ask for destructive",
    hint: "Reads run; writes, sends and deletes need human approval",
    appliedToast: "destructive tools ask a human",
  },
  {
    value: "block",
    label: "Block destructive",
    hint: "Reads run; writes, sends and deletes never do",
    appliedToast: "destructive tools blocked",
  },
];

const AUDIENCES: {
  id: "members" | "agents";
  label: string;
  sub: string;
}[] = [
  {
    id: "members",
    label: "Members",
    sub: "People using their own or shared credentials. Sets the team baseline — individuals can still tighten their own.",
  },
  {
    id: "agents",
    label: "Agents",
    sub: "Every service account at once. Adjust per agent or per tool afterwards.",
  },
];

/** Admin settings: custom-server gate, policy baselines, server access, rules. */
export function GatewayTeamSettings() {
  const { config, allowCustomServers, updateSettings, applyPreset } =
    useGatewayConfig();
  const { servers, updateServer, setAllEnabled } = useGatewayServers();
  const { rules, rulesLoading, toggleRule } = useGatewayRules({
    enabled: true,
  });
  const [serverSearch, setServerSearch] = useState("");

  const enabledCount = servers.filter(
    (server) => server.is_team_enabled,
  ).length;
  const filteredServers = servers.filter(
    (server) =>
      !serverSearch ||
      server.name.toLowerCase().includes(serverSearch.trim().toLowerCase()),
  );

  return (
    <Flex direction="column" gap="4" className="min-w-0">
      <Text className="font-bold text-[28px] leading-tight">Team settings</Text>

      <Text className="font-medium text-base">Custom servers</Text>
      <Flex
        align="center"
        justify="between"
        gap="3"
        className="rounded-[10px] border border-gray-5 p-3"
      >
        <div>
          <Text as="div" className="font-medium text-sm">
            Allow custom servers
          </Text>
          <Text as="div" color="gray" className="text-[13px]">
            Members can add their own MCP servers, the same way admins do. Team
            rules and baselines still apply.
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

      <Text className="font-medium text-base">Approval baselines</Text>
      <Flex direction="column" gap="2">
        {AUDIENCES.map((audience) => {
          const current =
            audience.id === "members"
              ? config?.member_default_preset
              : config?.agent_default_preset;
          return (
            <Flex
              key={audience.id}
              direction="column"
              gap="2"
              className="rounded-[10px] border border-gray-5 p-3"
            >
              <div>
                <Text as="div" className="font-medium text-sm">
                  {audience.label}
                </Text>
                <Text as="div" color="gray" className="text-[13px]">
                  {audience.sub}
                </Text>
              </div>
              <Flex gap="2" wrap="wrap">
                {PRESETS.map((preset) => (
                  <Button
                    key={preset.value}
                    variant={current === preset.value ? "solid" : "surface"}
                    color={current === preset.value ? undefined : "gray"}
                    size="1"
                    title={preset.hint}
                    onClick={() =>
                      applyPreset(
                        { audience: audience.id, preset: preset.value },
                        {
                          onSuccess: () =>
                            toast.success(
                              `${audience.id === "members" ? "Member" : "Agent"} baseline updated — ${preset.appliedToast}`,
                            ),
                        },
                      )
                    }
                  >
                    {preset.label}
                  </Button>
                ))}
              </Flex>
            </Flex>
          );
        })}
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
            onChange={(e) => setServerSearch(e.target.value)}
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
                  onClick={() => setServerSearch("")}
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
      <div className="rounded-[10px] border border-gray-5">
        {filteredServers.map((server) => (
          <Flex
            key={server.id}
            align="center"
            gap="3"
            className={`border-gray-5 border-b px-3 py-2 last:border-b-0 ${server.is_team_enabled ? "" : "opacity-60"}`}
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
      </div>

      <Separator size="4" />

      <Text className="font-medium text-base">Team rules</Text>
      <Text color="gray" className="text-[13px]">
        Guardrails evaluated before any scope policy. A matching enabled rule
        locks the tool for its audience — no scope can loosen it.
      </Text>
      <div className="rounded-[10px] border border-gray-5">
        {rules.map((rule) => (
          <Flex
            key={rule.id}
            align="center"
            gap="3"
            className="border-gray-5 border-b px-3 py-2 last:border-b-0"
          >
            <Flex direction="column" className="min-w-0 flex-1">
              <Text truncate className="font-medium text-sm">
                {rule.name}
              </Text>
              <Text color="gray" className="text-xs">
                {rule.description}
              </Text>
            </Flex>
            <Badge
              color={rule.effect === "do_not_use" ? "red" : "amber"}
              variant="soft"
              size="1"
            >
              {rule.effect === "do_not_use" ? "Blocks" : "Asks a human"}
            </Badge>
            <Switch
              size="1"
              checked={rule.enabled}
              onCheckedChange={(enabled) =>
                toggleRule({ ruleId: rule.id, name: rule.name, enabled })
              }
            />
          </Flex>
        ))}
        {rules.length === 0 && !rulesLoading && (
          <Text color="gray" className="block px-3 py-3 text-[13px] italic">
            No team rules yet.
          </Text>
        )}
      </div>
    </Flex>
  );
}
