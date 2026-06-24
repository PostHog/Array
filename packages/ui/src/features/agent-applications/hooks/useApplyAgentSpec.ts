import type {
  AgentRevision,
  AgentRevisionState,
  AgentSpec,
} from "@posthog/shared/agent-platform-types";
import { useAuthenticatedClient } from "@posthog/ui/features/auth/authClient";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuthStateValue } from "../../auth/store";
import { agentApplicationsKeys } from "./agentApplicationsKeys";

/**
 * Apply a spec change ("create draft and apply changes"): if the target
 * revision is already a draft, PATCH its spec in place; otherwise clone it to a
 * fresh draft first and PATCH that. Freeze/promote stay separate (the revision
 * bar's lifecycle buttons) — this only lands the edit on an editable draft.
 *
 * Returns the revision the change landed on so the caller can select it (it's a
 * new draft whenever the source wasn't a draft).
 */
export function useApplyAgentSpec(
  idOrSlug: string,
  applicationId: string | undefined,
) {
  const client = useAuthenticatedClient();
  const queryClient = useQueryClient();
  const projectId = useAuthStateValue((state) => state.currentProjectId);

  return useMutation<
    AgentRevision,
    Error,
    { revision: { id: string; state: AgentRevisionState }; spec: AgentSpec }
  >({
    mutationFn: async ({ revision, spec }) => {
      let targetId = revision.id;
      if (revision.state !== "draft") {
        if (!applicationId) {
          throw new Error("Application not loaded yet");
        }
        const draft = await client.createAgentDraftRevisionFrom(
          applicationId,
          revision.id,
        );
        targetId = draft.id;
      }
      return client.updateAgentRevisionSpec(idOrSlug, targetId, spec);
    },
    onSuccess: () => {
      for (const key of [
        agentApplicationsKeys.detail(projectId, idOrSlug),
        agentApplicationsKeys.revisions(projectId, idOrSlug),
        ["agent-applications", "revision", projectId, idOrSlug],
      ]) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });
}
