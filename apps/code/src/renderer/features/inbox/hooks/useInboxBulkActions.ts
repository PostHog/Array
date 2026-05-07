import type { DismissReportDialogResult } from "@features/inbox/components/DismissReportDialog";
import { useInboxReportSelectionStore } from "@features/inbox/stores/inboxReportSelectionStore";
import { inboxStatusLabel } from "@features/inbox/utils/inboxSort";
import { useAuthenticatedMutation } from "@hooks/useAuthenticatedMutation";
import type { SignalReport } from "@shared/types";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { toast } from "sonner";

type BulkActionName = "suppress" | "snooze" | "delete" | "reingest";

interface BulkActionResult {
  successCount: number;
  failureCount: number;
}

const inboxQueryKey = ["inbox", "signal-reports"] as const;

/** Active workflow statuses for snooze and suppress. Terminal `suppressed` / `deleted` are excluded. */
const suppressibleStatuses = new Set<SignalReport["status"]>([
  "potential",
  "candidate",
  "in_progress",
  "pending_input",
  "ready",
  "failed",
]);

/** Clause after "Disabled because …" (see `@components/ui/Button`). */
const DISABLED_NO_SELECTION = "you haven't selected a report";

/** Statuses that block suppression; labels match `inboxStatusLabel`. */
const SUPPRESS_BLOCKED_STATUS_PHRASE = (
  ["suppressed", "deleted"] as const satisfies readonly SignalReport["status"][]
)
  .map((status) => inboxStatusLabel(status))
  .join(" or ");

type SelectedReportEligibility = {
  selectedReports: SignalReport[];
  selectedIds: string[];
  selectedCount: number;
  snoozeDisabledReason: string | null;
  suppressDisabledReason: string | null;
  deleteDisabledReason: string | null;
  reingestDisabledReason: string | null;
};

function formatBulkActionSummary(
  action: BulkActionName,
  result: BulkActionResult,
): string {
  const { successCount, failureCount } = result;
  const pluralized = successCount === 1 ? "report" : "reports";
  const formulated =
    action === "suppress"
      ? `${pluralized} dismissed`
      : action === "snooze"
        ? `${pluralized} snoozed`
        : action === "delete"
          ? `${pluralized} deleted`
          : `${pluralized} reingested`;
  if (failureCount === 0) {
    return `${successCount} ${formulated}`;
  }
  return `${successCount} ${formulated}, ${failureCount} failed`;
}

function getSnoozeOrSuppressDisabledReason(
  selectedCount: number,
  selectedReports: SignalReport[],
): string | null {
  if (selectedCount === 0) {
    return DISABLED_NO_SELECTION;
  }
  const ok = selectedReports.every((report) =>
    suppressibleStatuses.has(report.status),
  );
  if (ok) {
    return null;
  }
  return `every selected report must not already be ${SUPPRESS_BLOCKED_STATUS_PHRASE}`;
}

function getSelectedReportEligibility(
  reports: SignalReport[],
  selectedIds: string[],
): SelectedReportEligibility {
  const selectedIdSet = new Set(selectedIds);
  const selectedReports = reports.filter((report) =>
    selectedIdSet.has(report.id),
  );
  const selectedCount = selectedReports.length;

  const snoozeOrSuppressDisabledReason = getSnoozeOrSuppressDisabledReason(
    selectedCount,
    selectedReports,
  );

  return {
    selectedReports,
    selectedIds: selectedReports.map((report) => report.id),
    selectedCount,
    snoozeDisabledReason: snoozeOrSuppressDisabledReason,
    suppressDisabledReason: snoozeOrSuppressDisabledReason,
    deleteDisabledReason: selectedCount === 0 ? DISABLED_NO_SELECTION : null,
    reingestDisabledReason: selectedCount === 0 ? DISABLED_NO_SELECTION : null,
  };
}

/** Toolbar: selected report ids. Dismiss dialog: that report's id, or null when closed. */
export type InboxBulkSelection = string[] | string | null;

const emptyBulkIds: string[] = [];

function effectiveBulkIdsFromSelection(
  selection: InboxBulkSelection,
): string[] {
  if (selection == null) {
    return emptyBulkIds;
  }
  if (Array.isArray(selection)) {
    return selection;
  }
  return [selection];
}

function bulkSelectionKey(selection: InboxBulkSelection): string {
  if (selection == null) {
    return "";
  }
  if (Array.isArray(selection)) {
    return selection.join("\0");
  }
  return selection;
}

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
  const clearSelection = useInboxReportSelectionStore(
    (state) => state.clearSelection,
  );

  const effectiveBulkIds = effectiveBulkIdsFromSelection(selection);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `bulkKeys` serializes selection so callers may pass fresh array literals (or a lone id) without busting this memo.
  const eligibility = useMemo(
    () => getSelectedReportEligibility(reports, effectiveBulkIds),
    [reports, bulkSelectionKey(selection)],
  );

  const invalidateInboxQueries = useCallback(async () => {
    await queryClient.invalidateQueries({
      queryKey: inboxQueryKey,
      exact: false,
    });
  }, [queryClient]);

  const suppressMutation = useAuthenticatedMutation(
    async (
      client,
      input: { reportIds: string[]; dismissal?: DismissReportDialogResult },
    ) => {
      const results = await Promise.allSettled(
        input.reportIds.map((reportId) =>
          client.updateSignalReportState(reportId, {
            state: "suppressed",
            ...(input.dismissal
              ? {
                  dismissal_reason: input.dismissal.reason,
                  dismissal_note: input.dismissal.note.slice(0, 4000),
                }
              : {}),
          }),
        ),
      );

      const successCount = results.filter(
        (result) => result.status === "fulfilled",
      ).length;

      return {
        successCount,
        failureCount: results.length - successCount,
      };
    },
    {
      onSuccess: async (result) => {
        await invalidateInboxQueries();
        clearSelection();

        if (result.failureCount > 0) {
          toast.error(formatBulkActionSummary("suppress", result));
          return;
        }

        toast.success(formatBulkActionSummary("suppress", result));
      },
      onError: (error) => {
        toast.error(error.message || "Failed to dismiss reports");
      },
    },
  );

  const snoozeMutation = useAuthenticatedMutation(
    async (client, reportIds: string[]) => {
      const results = await Promise.allSettled(
        reportIds.map((reportId) =>
          client.updateSignalReportState(reportId, {
            state: "potential",
            snooze_for: 1,
          }),
        ),
      );

      const successCount = results.filter(
        (result) => result.status === "fulfilled",
      ).length;

      return {
        successCount,
        failureCount: results.length - successCount,
      };
    },
    {
      onSuccess: async (result) => {
        await invalidateInboxQueries();
        clearSelection();

        if (result.failureCount > 0) {
          toast.error(formatBulkActionSummary("snooze", result));
          return;
        }

        toast.success(formatBulkActionSummary("snooze", result));
      },
      onError: (error) => {
        toast.error(error.message || "Failed to snooze reports");
      },
    },
  );

  const deleteMutation = useAuthenticatedMutation(
    async (client, reportIds: string[]) => {
      const results = await Promise.allSettled(
        reportIds.map((reportId) => client.deleteSignalReport(reportId)),
      );

      const successCount = results.filter(
        (result) => result.status === "fulfilled",
      ).length;

      return {
        successCount,
        failureCount: results.length - successCount,
      };
    },
    {
      onSuccess: async (result) => {
        await invalidateInboxQueries();
        clearSelection();

        if (result.failureCount > 0) {
          toast.error(formatBulkActionSummary("delete", result));
          return;
        }

        toast.success(formatBulkActionSummary("delete", result));
      },
      onError: (error) => {
        toast.error(error.message || "Failed to delete reports");
      },
    },
  );

  const reingestMutation = useAuthenticatedMutation(
    async (client, reportIds: string[]) => {
      const results = await Promise.allSettled(
        reportIds.map((reportId) => client.reingestSignalReport(reportId)),
      );

      const successCount = results.filter(
        (result) => result.status === "fulfilled",
      ).length;

      return {
        successCount,
        failureCount: results.length - successCount,
      };
    },
    {
      onSuccess: async (result) => {
        await invalidateInboxQueries();
        clearSelection();

        if (result.failureCount > 0) {
          toast.error(formatBulkActionSummary("reingest", result));
          return;
        }

        toast.success(formatBulkActionSummary("reingest", result));
      },
      onError: (error) => {
        toast.error(error.message || "Failed to reingest reports");
      },
    },
  );

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
    deleteMutation,
    eligibility.deleteDisabledReason,
    eligibility.selectedIds,
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
