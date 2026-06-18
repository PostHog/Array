import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/features/auth";
import {
  type DismissSignalReportInput,
  dismissSignalReport,
  getAvailableSuggestedReviewers,
  getSignalProcessingState,
  getSignalReport,
  getSignalReportArtefacts,
  getSignalReportSignals,
  getSignalReports,
  updateSignalReportArtefact,
} from "../api";
import { INBOX_REFETCH_INTERVAL_MS } from "../constants";
import { useInboxFilterStore } from "../stores/inboxFilterStore";
import type {
  AvailableSuggestedReviewersResponse,
  SignalProcessingStateResponse,
  SignalReport,
  SignalReportArtefactsResponse,
  SignalReportSignalsResponse,
  SignalReportsQueryParams,
  SignalReportsResponse,
  SuggestedReviewer,
  SuggestedReviewerWriteEntry,
} from "../types";
import {
  buildPriorityFilterParam,
  buildSignalReportListOrdering,
  buildStatusFilterParam,
  buildSuggestedReviewerFilterParam,
} from "../utils";

export const inboxKeys = {
  all: ["inbox", "signal-reports"] as const,
  list: (params?: SignalReportsQueryParams) =>
    [...inboxKeys.all, "list", params ?? {}] as const,
  detail: (reportId: string) => [...inboxKeys.all, reportId, "detail"] as const,
  artefacts: (reportId: string) =>
    [...inboxKeys.all, reportId, "artefacts"] as const,
  signals: (reportId: string) =>
    [...inboxKeys.all, reportId, "signals"] as const,
  processingState: ["inbox", "signal-processing-state"] as const,
};

export function useInboxReports(options?: { enabled?: boolean }) {
  const { projectId, oauthAccessToken } = useAuthStore();
  const sortField = useInboxFilterStore((s) => s.sortField);
  const sortDirection = useInboxFilterStore((s) => s.sortDirection);
  const statusFilter = useInboxFilterStore((s) => s.statusFilter);
  const sourceProductFilter = useInboxFilterStore((s) => s.sourceProductFilter);
  const suggestedReviewerFilter = useInboxFilterStore(
    (s) => s.suggestedReviewerFilter,
  );
  const priorityFilter = useInboxFilterStore((s) => s.priorityFilter);

  const params: SignalReportsQueryParams = {
    status: buildStatusFilterParam(statusFilter),
    ordering: buildSignalReportListOrdering(sortField, sortDirection),
    source_product:
      sourceProductFilter.length > 0
        ? sourceProductFilter.join(",")
        : undefined,
    suggested_reviewers:
      suggestedReviewerFilter.length > 0
        ? buildSuggestedReviewerFilterParam(suggestedReviewerFilter)
        : undefined,
    priority: buildPriorityFilterParam(priorityFilter),
  };

  const query = useQuery<SignalReportsResponse>({
    queryKey: inboxKeys.list(params),
    queryFn: () => getSignalReports(params),
    enabled: !!projectId && !!oauthAccessToken && (options?.enabled ?? true),
    refetchInterval: INBOX_REFETCH_INTERVAL_MS,
  });

  return {
    reports: query.data?.results ?? [],
    totalCount: query.data?.count ?? 0,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error?.message ?? null,
    refetch: query.refetch,
  };
}

export function useInboxReport(reportId: string | null) {
  const { projectId, oauthAccessToken } = useAuthStore();

  return useQuery<SignalReport | null>({
    queryKey: inboxKeys.detail(reportId ?? ""),
    queryFn: () => {
      if (!reportId) throw new Error("reportId is required");
      return getSignalReport(reportId);
    },
    enabled: !!projectId && !!oauthAccessToken && !!reportId,
  });
}

export function useSignalProcessingState(options?: { enabled?: boolean }) {
  const { projectId, oauthAccessToken } = useAuthStore();

  return useQuery<SignalProcessingStateResponse>({
    queryKey: inboxKeys.processingState,
    queryFn: () => getSignalProcessingState(),
    enabled: !!projectId && !!oauthAccessToken && (options?.enabled ?? true),
    refetchInterval: INBOX_REFETCH_INTERVAL_MS,
  });
}

export function useAvailableSuggestedReviewers(options?: {
  enabled?: boolean;
}) {
  const { projectId, oauthAccessToken } = useAuthStore();

  return useQuery<AvailableSuggestedReviewersResponse>({
    queryKey: [...inboxKeys.all, "available-reviewers"] as const,
    queryFn: () => getAvailableSuggestedReviewers(),
    enabled: !!projectId && !!oauthAccessToken && (options?.enabled ?? true),
    staleTime: 5 * 60 * 1000,
    refetchInterval: 60_000,
  });
}

export function useInboxReportArtefacts(reportId: string | null) {
  const { projectId, oauthAccessToken } = useAuthStore();

  return useQuery<SignalReportArtefactsResponse>({
    queryKey: inboxKeys.artefacts(reportId ?? ""),
    queryFn: () => {
      if (!reportId) throw new Error("reportId is required");
      return getSignalReportArtefacts(reportId);
    },
    enabled: !!projectId && !!oauthAccessToken && !!reportId,
  });
}

export function useInboxReportSignals(reportId: string | null) {
  const { projectId, oauthAccessToken } = useAuthStore();

  return useQuery<SignalReportSignalsResponse>({
    queryKey: inboxKeys.signals(reportId ?? ""),
    queryFn: () => {
      if (!reportId) throw new Error("reportId is required");
      return getSignalReportSignals(reportId);
    },
    enabled: !!projectId && !!oauthAccessToken && !!reportId,
  });
}

interface UpdateSuggestedReviewersVariables {
  artefactId: string;
  content: SuggestedReviewerWriteEntry[];
  optimisticReviewers: SuggestedReviewer[];
}

export function useUpdateSuggestedReviewers(reportId: string) {
  const queryClient = useQueryClient();
  const queryKey = inboxKeys.artefacts(reportId);

  return useMutation<
    void,
    Error,
    UpdateSuggestedReviewersVariables,
    { previous: SignalReportArtefactsResponse | undefined }
  >({
    mutationFn: ({ artefactId, content }) =>
      updateSignalReportArtefact(reportId, artefactId, content),
    onMutate: async ({ artefactId, optimisticReviewers }) => {
      await queryClient.cancelQueries({ queryKey });
      const previous =
        queryClient.getQueryData<SignalReportArtefactsResponse>(queryKey);
      if (previous) {
        queryClient.setQueryData<SignalReportArtefactsResponse>(queryKey, {
          ...previous,
          results: previous.results.map((artefact) =>
            artefact.id === artefactId &&
            artefact.type === "suggested_reviewers"
              ? { ...artefact, content: optimisticReviewers }
              : artefact,
          ),
        });
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKey, context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });
}

export function useDismissReport(reportId: string) {
  const queryClient = useQueryClient();

  return useMutation<SignalReport, Error, DismissSignalReportInput>({
    mutationFn: (input) => dismissSignalReport(reportId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inboxKeys.detail(reportId) });
      queryClient.invalidateQueries({ queryKey: inboxKeys.all });
    },
  });
}
