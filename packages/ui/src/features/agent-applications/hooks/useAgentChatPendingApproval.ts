import type { AgentApprovalRequest } from "@posthog/shared/agent-platform-types";
import { useAuthenticatedQuery } from "@posthog/ui/hooks/useAuthenticatedQuery";
import { useAuthStateValue } from "../../auth/store";
import { agentApplicationsKeys } from "./agentApplicationsKeys";

/**
 * The oldest queued approval for `sessionId` against this agent, or null.
 * Drives the in-chat approval card in the live preview / agent builder dock:
 * when the agent proposes an approval-gated tool call, the runner pauses
 * silently (no SSE signal) — we poll the approvals endpoint and surface the
 * decision inline.
 *
 * Tighter poll than {@link useAgentApplicationApprovals} (2s vs 10s) because
 * this drives a live interaction; react-query pauses while the tab is
 * unfocused. The cache key shares the `approvals` prefix that
 * `useDecideAgentApproval` invalidates, so a decide clears the card
 * immediately and the runner's SSE follow-up resumes the chat.
 */
export function useAgentChatPendingApproval(
  idOrSlug: string,
  sessionId: string | null,
) {
  const projectId = useAuthStateValue((state) => state.currentProjectId);
  return useAuthenticatedQuery<AgentApprovalRequest | null>(
    agentApplicationsKeys.chatPendingApproval(projectId, idOrSlug, sessionId),
    async (client) => {
      if (!sessionId) return null;
      const results = await client.listAgentApplicationApprovals(idOrSlug, {
        state: "queued",
      });
      const forSession = results.filter((r) => r.session_id === sessionId);
      if (forSession.length === 0) return null;
      forSession.sort((a, b) => a.created_at.localeCompare(b.created_at));
      return forSession[0] ?? null;
    },
    {
      enabled: !!projectId && !!idOrSlug && !!sessionId,
      staleTime: 2_000,
      refetchInterval: 2_000,
    },
  );
}
