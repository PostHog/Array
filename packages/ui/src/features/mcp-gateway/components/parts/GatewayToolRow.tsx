import { CaretRight, Lock } from "@phosphor-icons/react";
import type {
  McpApprovalState,
  McpResolvedToolPolicy,
} from "@posthog/api-client/posthog-client";
import { ToolPolicyToggle } from "@posthog/ui/features/mcp-servers/components/parts/ToolPolicyToggle";
import { Badge, Flex, Text, Tooltip } from "@radix-ui/themes";
import { useState } from "react";

interface GatewayToolRowProps {
  /** Mono prefix rendered before the tool name, e.g. "internal-wiki". */
  serverSlug: string;
  policy: McpResolvedToolPolicy;
  editable: boolean;
  onChange: (state: McpApprovalState) => void;
}

/**
 * One expandable tool row: fully-qualified mono name, description, and the
 * policy control — replaced by a locked pill when an org rule decided the
 * state, or a lock badge + read-only toggle when the admin baseline did.
 */
export function GatewayToolRow({
  serverSlug,
  policy,
  editable,
  onChange,
}: GatewayToolRowProps) {
  const [open, setOpen] = useState(false);
  const ruleLocked = policy.locked && policy.decided_by === "rule";
  const adminLocked = policy.locked && policy.decided_by !== "rule";
  const blocked = policy.policy_state === "do_not_use";

  return (
    <div className="border-gray-5 border-b last:border-b-0">
      <div className="grid grid-cols-[1fr_auto] items-center gap-3 px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="min-w-0 text-left"
        >
          <Flex align="center" gap="1">
            <CaretRight
              size={10}
              weight="bold"
              className={`shrink-0 text-gray-10 transition-transform ${open ? "rotate-90" : ""}`}
            />
            <Text
              truncate
              className={`font-mono text-[12.5px] ${blocked ? "text-gray-10 line-through" : ""}`}
            >
              {serverSlug}.{policy.tool_name}
            </Text>
          </Flex>
          {policy.description ? (
            <Text color="gray" truncate as="div" className="pl-[18px] text-xs">
              {policy.description}
            </Text>
          ) : (
            <Text
              color="gray"
              truncate
              as="div"
              className="pl-[18px] text-xs italic"
            >
              No description provided
            </Text>
          )}
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
        <Flex direction="column" gap="2" className="px-3 pb-3 pl-[30px]">
          <div>
            <Text
              color="gray"
              as="div"
              className="font-medium text-[10px] uppercase tracking-[0.06em]"
            >
              Description
            </Text>
            <Text
              as="div"
              className={`text-[13px] ${policy.description ? "" : "text-gray-10 italic"}`}
            >
              {policy.description || "No description provided."}
            </Text>
          </div>
          {ruleLocked && (
            <div>
              <Text
                color="gray"
                as="div"
                className="font-medium text-[10px] uppercase tracking-[0.06em]"
              >
                Applied rule
              </Text>
              <Text as="div" className="text-[13px]">
                <span className="font-semibold">{policy.rule_name}</span>
                {policy.rule_description ? ` — ${policy.rule_description}` : ""}
              </Text>
            </div>
          )}
        </Flex>
      )}
    </div>
  );
}
