import { ArrowSquareOutIcon, LockKeyIcon } from "@phosphor-icons/react";
import { formatRelativeTimeShort } from "@posthog/shared";
import type { AgentApprovalRequest } from "@posthog/shared/agent-platform-types";
import { Badge } from "@posthog/ui/primitives/Badge";
import { Flex, Text } from "@radix-ui/themes";
import { Link } from "@tanstack/react-router";
import { useDecideAgentApproval } from "../hooks/useDecideAgentApproval";
import { approvalStateColor, approvalStateLabel } from "../utils/format";
import { AgentApprovalDecisionForm } from "./AgentApprovalDecisionForm";
import { ArgsSection } from "./AgentApprovalDetail";

/**
 * Inline pending-approval card surfaced in the live chat preview / agent
 * builder dock. Renders between the conversation and the composer when the
 * agent has paused on an approval-gated tool call; deciding here reuses the
 * standard `useDecideAgentApproval` mutation, and the SSE follow-up resumes
 * the chat naturally.
 */
export function AgentChatPendingApprovalCard({
  idOrSlug,
  approval,
}: {
  idOrSlug: string;
  approval: AgentApprovalRequest;
}) {
  const decide = useDecideAgentApproval(idOrSlug);
  return (
    <div className="shrink-0 border-(--amber-6) border-t bg-(--amber-2) px-4 pt-3 pb-2">
      <Flex align="start" justify="between" gap="3" className="mb-2">
        <Flex direction="column" gap="1" className="min-w-0">
          <Flex align="center" gap="2" className="min-w-0">
            <LockKeyIcon size={13} className="shrink-0 text-(--amber-11)" />
            <Text className="font-semibold text-[12.5px] text-gray-12">
              Approval needed
            </Text>
            <Badge color={approvalStateColor(approval.state)}>
              {approvalStateLabel(approval.state)}
            </Badge>
            <Text className="truncate font-medium text-[12.5px] text-gray-12 [font-family:var(--font-mono)]">
              {approval.tool_name}
            </Text>
          </Flex>
          <Text className="text-[11px] text-gray-10">
            expires {formatRelativeTimeShort(approval.expires_at)}
          </Text>
        </Flex>
        <Link
          to="/code/agents/applications/$idOrSlug/approvals"
          params={{ idOrSlug }}
          search={{ request: approval.id }}
          className="inline-flex shrink-0 items-center gap-1 text-[11.5px] text-gray-11 no-underline hover:text-gray-12"
        >
          Open in Approvals
          <ArrowSquareOutIcon size={11} />
        </Link>
      </Flex>
      <ArgsSection label="Proposed arguments" args={approval.proposed_args} />
      <AgentApprovalDecisionForm
        approval={approval}
        busy={decide.isPending}
        error={
          decide.isError
            ? decide.error instanceof Error
              ? decide.error.message
              : "Decision failed"
            : null
        }
        onSubmit={(body) => decide.mutate({ approvalId: approval.id, body })}
      />
    </div>
  );
}
