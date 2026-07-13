import type {
  AgentApprovalRequest,
  AgentApprovalsListParams,
} from "@posthog/shared/agent-platform-types";
import { useAuthenticatedQuery } from "@posthog/ui/hooks/useAuthenticatedQuery";
import { useAuthStateValue } from "../../auth/store";
import { agentApplicationsKeys } from "./agentApplicationsKeys";

/**
 * Fleet-wide tool-approval requests across every agent on the team
 * (team-admin only). Optionally filtered to a single state; omit for all.
 */
export function useAgentFleetApprovals(params?: AgentApprovalsListParams) {
  const projectId = useAuthStateValue((state) => state.currentProjectId);
  return useAuthenticatedQuery<AgentApprovalRequest[]>(
    agentApplicationsKeys.fleetApprovals(projectId, params?.state),
    (client) => client.listAgentFleetApprovals(params),
    {
      enabled: !!projectId,
      staleTime: 10_000,
      refetchInterval: 10_000,
    },
  );
}
