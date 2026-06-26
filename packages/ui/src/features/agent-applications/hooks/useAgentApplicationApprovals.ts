import type {
  AgentApprovalRequest,
  AgentApprovalsListParams,
} from "@posthog/shared/agent-platform-types";
import { useAuthenticatedQuery } from "@posthog/ui/hooks/useAuthenticatedQuery";
import { useAuthStateValue } from "../../auth/store";
import { agentApplicationsKeys } from "./agentApplicationsKeys";

/**
 * Lists tool-approval requests for one agent. Optionally filtered to a single
 * state (the backend accepts one `state` value); omit for all states.
 */
export function useAgentApplicationApprovals(
  idOrSlug: string,
  params?: AgentApprovalsListParams,
) {
  const projectId = useAuthStateValue((state) => state.currentProjectId);
  return useAuthenticatedQuery<AgentApprovalRequest[]>(
    agentApplicationsKeys.approvals(projectId, idOrSlug, params?.state),
    (client) => client.listAgentApplicationApprovals(idOrSlug, params),
    {
      enabled: !!projectId && !!idOrSlug,
      staleTime: 10_000,
      // Queued approvals change as agents run; poll while the tab is focused.
      refetchInterval: 10_000,
    },
  );
}
