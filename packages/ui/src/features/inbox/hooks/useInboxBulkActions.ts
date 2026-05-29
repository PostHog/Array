import type { PostHogAPIClient } from "@posthog/api-client/posthog-client";
import type { InboxBulkActionService } from "@posthog/core/inbox/bulkActionService";
import {
  type BulkActionName,
  type BulkActionResult,
  bulkSelectionKey,
  effectiveBulkIdsFromSelection,
  formatBulkActionSummary,
  getSelectedReportEligibility,
  type InboxBulkSelection,
} from "@posthog/core/inbox/bulkActions";
import { INBOX_BULK_ACTION_SERVICE } from "@posthog/core/inbox/identifiers";
import { useService } from "@posthog/di/react";
import type { SignalReport } from "@posthog/shared/domain-types";
import { useOptionalAuthenticatedClient } from "@posthog/ui/features/auth/authClient";
import type { DismissReportDialogResult } from "@posthog/ui/features/inbox/components/DismissReportDialog";
import { useInboxReportSelectionStore } from "@posthog/ui/features/inbox/inboxReportSelectionStore";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { toast } from "sonner";

export type { InboxBulkSelection } from "@posthog/core/inbox/bulkActions";

const inboxQueryKey = ["inbox", "signal-reports"] as const;

/** Snooze disabled reason when `selectedIds` are treated as the bulk selection (matches toolbar logic). */
export function inboxBulkSnoozeDisabledReason(
  reports: SignalReport[],
  selectedIds: string[],
): string | null {
  return getSelectedReportEligibility(reports, selectedIds)
    .snoozeDisabledReason;
}

/** Suppress/dismiss disabled reason when `selectedIds` are treated as the bulk selection. */
export function inboxBulkSuppressDisabledReason(
  reports: SignalReport[],
  selectedIds: string[],
): string | null {
  return getSelectedReportEligibility(reports, selectedIds)
    .suppressDisabledReason;
}

export function useInboxBulkActions(
  reports: SignalReport[],
  selection: InboxBulkSelection,
) {
  const queryClient = useQueryClient();
  const service = useService<InboxBulkActionService>(INBOX_BULK_ACTION_SERVICE);
  const client = useOptionalAuthenticatedClient();
  const clearSelection = useInboxReportSelectionStore(
    (state) => state.clearSelection,
  );

  const effectiveBulkIds = effectiveBulkIdsFromSelection(selection);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `bulkKeys` serializes selection so callers may pass fresh array literals (or a lone id) without busting this memo.
  const eligibility = useMemo(
    () => getSelectedReportEligibility(reports, effectiveBulkIds),
    [reports, bulkSelectionKey(selection)],
  );

  const settle = useCallback(
    async (action: BulkActionName, result: BulkActionResult) => {
      await queryClient.invalidateQueries({
        queryKey: inboxQueryKey,
        exact: false,
      });
      clearSelection();
      const message = formatBulkActionSummary(action, result);
      if (result.failureCount > 0) {
        toast.error(message);
        return;
      }
      toast.success(message);
    },
    [queryClient, clearSelection],
  );

  const run = useCallback(
    (
      action: BulkActionName,
      perform: (
        client: PostHogAPIClient,
        reportIds: string[],
      ) => Promise<BulkActionResult>,
    ) =>
      async (reportIds: string[]) => {
        if (!client) {
          throw new Error("Not authenticated");
        }
        const result = await perform(client, reportIds);
        await settle(action, result);
        return result;
      },
    [client, settle],
  );

  const suppressMutation = useMutation({
    mutationFn: (input: {
      reportIds: string[];
      dismissal?: DismissReportDialogResult;
    }) => {
      if (!client) {
        throw new Error("Not authenticated");
      }
      return service
        .suppressReports(client, input.reportIds, input.dismissal)
        .then(async (result) => {
          await settle("suppress", result);
          return result;
        });
    },
    onError: (error: Error) =>
      toast.error(error.message || "Failed to dismiss reports"),
  });
  const snoozeMutation = useMutation({
    mutationFn: run("snooze", (c, ids) => service.snoozeReports(c, ids)),
    onError: (error: Error) =>
      toast.error(error.message || "Failed to snooze reports"),
  });
  const deleteMutation = useMutation({
    mutationFn: run("delete", (c, ids) => service.deleteReports(c, ids)),
    onError: (error: Error) =>
      toast.error(error.message || "Failed to delete reports"),
  });
  const reingestMutation = useMutation({
    mutationFn: run("reingest", (c, ids) => service.reingestReports(c, ids)),
    onError: (error: Error) =>
      toast.error(error.message || "Failed to reingest reports"),
  });

  const suppressSelected = useCallback(
    async (dismissal?: DismissReportDialogResult) => {
      if (eligibility.suppressDisabledReason !== null) {
        return false;
      }
      await suppressMutation.mutateAsync({
        reportIds: eligibility.selectedIds,
        ...(dismissal != null ? { dismissal } : {}),
      });
      return true;
    },
    [
      eligibility.suppressDisabledReason,
      eligibility.selectedIds,
      suppressMutation,
    ],
  );

  const snoozeSelected = useCallback(async () => {
    if (eligibility.snoozeDisabledReason !== null) {
      return false;
    }
    await snoozeMutation.mutateAsync(eligibility.selectedIds);
    return true;
  }, [
    eligibility.snoozeDisabledReason,
    eligibility.selectedIds,
    snoozeMutation,
  ]);

  const deleteSelected = useCallback(async () => {
    if (eligibility.deleteDisabledReason !== null) {
      return false;
    }
    await deleteMutation.mutateAsync(eligibility.selectedIds);
    return true;
  }, [
    eligibility.deleteDisabledReason,
    eligibility.selectedIds,
    deleteMutation,
  ]);

  const reingestSelected = useCallback(async () => {
    if (eligibility.reingestDisabledReason !== null) {
      return false;
    }
    await reingestMutation.mutateAsync(eligibility.selectedIds);
    return true;
  }, [
    eligibility.reingestDisabledReason,
    eligibility.selectedIds,
    reingestMutation,
  ]);

  return {
    selectedReports: eligibility.selectedReports,
    selectedCount: eligibility.selectedCount,
    snoozeDisabledReason: eligibility.snoozeDisabledReason,
    suppressDisabledReason: eligibility.suppressDisabledReason,
    deleteDisabledReason: eligibility.deleteDisabledReason,
    reingestDisabledReason: eligibility.reingestDisabledReason,
    isSuppressing: suppressMutation.isPending,
    isSnoozing: snoozeMutation.isPending,
    isDeleting: deleteMutation.isPending,
    isReingesting: reingestMutation.isPending,
    suppressSelected,
    snoozeSelected,
    deleteSelected,
    reingestSelected,
  };
}
