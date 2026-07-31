import { CaretDown, CaretRight, Lock } from "@phosphor-icons/react";
import type {
  McpApprovalState,
  McpResolvedToolPolicy,
} from "@posthog/api-client/posthog-client";
import { ToolPolicyToggle } from "@posthog/ui/features/mcp-servers/components/parts/ToolPolicyToggle";
import { Badge, Flex, Text, Tooltip } from "@radix-ui/themes";
import { useState } from "react";

interface GatewayToolRowProps {
  policy: McpResolvedToolPolicy;
  editable: boolean;
  onChange: (state: McpApprovalState) => void;
}

/**
 * One expandable tool row: name, description, and the policy control —
 * replaced by a locked pill when an org rule decided the state, or a lock
 * badge + read-only toggle when the admin baseline did.
 */
export function GatewayToolRow({
  policy,
  editable,
  onChange,
}: GatewayToolRowProps) {
  const [open, setOpen] = useState(false);
  const hasDescription = !!policy.description?.trim();
  const ruleLocked = policy.locked && policy.decided_by === "rule";
  const adminLocked = policy.locked && policy.decided_by !== "rule";
  const blocked = policy.policy_state === "do_not_use";

  return (
    <div className="rounded border border-border bg-gray-1 transition-colors">
      <div className="flex w-full min-w-0 items-center gap-3 px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
          aria-expanded={open}
        >
          {open ? (
            <CaretDown
              size={12}
              weight="bold"
              className="shrink-0 text-gray-10"
            />
          ) : (
            <CaretRight
              size={12}
              weight="bold"
              className="shrink-0 text-gray-10"
            />
          )}
          <div className="flex min-w-0 flex-1 flex-col">
            <Text
              truncate
              className="select-text font-medium text-sm"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              {policy.tool_name}
            </Text>
            <Text
              color="gray"
              truncate
              style={{ fontStyle: hasDescription ? undefined : "italic" }}
              className="text-[13px]"
            >
              {hasDescription ? policy.description : "No description provided"}
            </Text>
          </div>
        </button>
        <div className="shrink-0">
          {ruleLocked ? (
            <Tooltip
              content={`${policy.rule_name} — team rule, overrides every scope.`}
            >
              <Badge color="gray" variant="soft" size="1">
                <Lock size={11} />
                {blocked
                  ? "Blocked by team policy"
                  : "Approval required by team policy"}
              </Badge>
            </Tooltip>
          ) : adminLocked ? (
            <Flex align="center" gap="2">
              <Tooltip
                content={`Set by your admin — locked at "${
                  blocked ? "Blocked" : "Requires approval"
                }". Ask an admin to change it.`}
              >
                <Badge color="gray" variant="soft" size="1">
                  <Lock size={11} />
                </Badge>
              </Tooltip>
              <div className="opacity-55">
                <ToolPolicyToggle
                  value={policy.policy_state}
                  onChange={() => {}}
                  disabled
                />
              </div>
            </Flex>
          ) : (
            <ToolPolicyToggle
              value={policy.policy_state}
              onChange={onChange}
              disabled={!editable}
            />
          )}
        </div>
      </div>
      {open && (
        <div className="border-gray-5 border-t bg-gray-2 px-3 py-3">
          <Flex direction="column" gap="3">
            <Flex direction="column" gap="1">
              <Text color="gray" className="font-medium text-[13px]">
                Description
              </Text>
              <Text
                className={
                  hasDescription
                    ? "whitespace-pre-wrap text-sm"
                    : "whitespace-pre-wrap text-gray-10 text-sm italic"
                }
              >
                {hasDescription
                  ? policy.description
                  : "No description provided."}
              </Text>
            </Flex>
            <Flex direction="column" gap="1">
              <Text color="gray" className="font-medium text-[13px]">
                Input schema
              </Text>
              <pre className="overflow-x-auto rounded bg-gray-3 p-2 text-xs">
                {JSON.stringify(policy.input_schema ?? {}, null, 2)}
              </pre>
            </Flex>
            {ruleLocked && (
              <Flex direction="column" gap="1">
                <Text color="gray" className="font-medium text-[13px]">
                  Applied rule
                </Text>
                <Text className="text-sm">
                  <span className="font-semibold">{policy.rule_name}</span>
                  {policy.rule_description
                    ? ` — ${policy.rule_description}`
                    : ""}
                </Text>
              </Flex>
            )}
          </Flex>
        </div>
      )}
    </div>
  );
}
