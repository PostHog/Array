import type {
  AgentApprovalRequest,
  DecideApprovalRequest,
} from "@posthog/shared/agent-platform-types";
import { useAuthenticatedClient } from "@posthog/ui/features/auth/authClient";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuthStateValue } from "../../auth/store";

interface DecideArgs {
  approvalId: string;
  body: DecideApprovalRequest;
}

/**
 * Approve or reject a queued tool-approval request. On success, refetches the
 * agent's approval lists (all state filters) so the row reflects its outcome,
 * and fires a toast so the caller doesn't have to add post-decide UX.
 */
export function useDecideAgentApproval(idOrSlug: string) {
  const client = useAuthenticatedClient();
  const queryClient = useQueryClient();
  const projectId = useAuthStateValue((state) => state.currentProjectId);

  return useMutation<AgentApprovalRequest, Error, DecideArgs>({
    mutationFn: ({ approvalId, body }) =>
      client.decideAgentApproval(idOrSlug, approvalId, body),
    onSuccess: (_data, { body }) => {
      void queryClient.invalidateQueries({
        queryKey: ["agent-applications", "approvals", projectId, idOrSlug],
      });
      if (body.decision === "approve") {
        toast.success("Approved", {
          description:
            body.edited_args !== undefined
              ? "Dispatched with edited arguments."
              : "Dispatched to the agent.",
        });
      } else {
        toast.success("Rejected", {
          description: "The agent will see the rejection.",
        });
      }
    },
    onError: (err) => {
      toast.error("Decision failed", {
        description: err instanceof Error ? err.message : undefined,
      });
    },
  });
}
