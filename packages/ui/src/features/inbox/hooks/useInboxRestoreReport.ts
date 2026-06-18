import { reportKeys } from "@posthog/ui/features/inbox/hooks/useInboxReports";
import { useAuthenticatedMutation } from "@posthog/ui/hooks/useAuthenticatedMutation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

/**
 * Restore a dismissed report back into the inbox. Reuses the `state` action's
 * `potential` transition (the same one the backend documents as "reopen"), which
 * is the only reopen path the backend exposes — the report re-enters the
 * pipeline as a fresh candidate rather than returning to its pre-dismissal
 * status (that prior status isn't persisted).
 *
 * Invalidates `reportKeys.all` so both the Dismissed list and the pipeline
 * tabs refetch and the restored report moves between them.
 */
export function useInboxRestoreReport() {
  const queryClient = useQueryClient();

  return useAuthenticatedMutation(
    async (client, reportId: string) =>
      client.updateSignalReportState(reportId, { state: "potential" }),
    {
      onSuccess: async () => {
        await queryClient.invalidateQueries({
          queryKey: reportKeys.all,
          exact: false,
        });
        toast.success("Report restored to inbox");
      },
      onError: (error) => {
        toast.error(error.message || "Failed to restore report");
      },
    },
  );
}
