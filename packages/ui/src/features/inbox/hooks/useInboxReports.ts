import type {
  AvailableSuggestedReviewersResponse,
  SignalProcessingStateResponse,
  SignalReport,
  SignalReportArtefactsResponse,
  SignalReportSignalsResponse,
  SignalReportsQueryParams,
  SignalReportsResponse,
  SuggestedReviewersArtefact,
  SuggestedReviewerWriteEntry,
} from "@posthog/shared/domain-types";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { toast } from "sonner";
import { useAuthenticatedInfiniteQuery } from "../../../hooks/useAuthenticatedInfiniteQuery";
import { useAuthenticatedMutation } from "../../../hooks/useAuthenticatedMutation";
import { useAuthenticatedQuery } from "../../../hooks/useAuthenticatedQuery";
import { getAuthIdentity, useAuthStateValue } from "../../auth/store";
import { useInboxAvailableSuggestedReviewersStore } from "../inboxAvailableSuggestedReviewersStore";

const REPORTS_PAGE_SIZE = 100;

export const reportKeys = {
  all: ["inbox", "signal-reports"] as const,
  list: (params?: SignalReportsQueryParams) =>
    [...reportKeys.all, "list", params ?? {}] as const,
  infiniteList: (params?: SignalReportsQueryParams) =>
    [...reportKeys.all, "infinite-list", params ?? {}] as const,
  detail: (reportId: string) =>
    [...reportKeys.all, reportId, "detail"] as const,
  artefacts: (reportId: string) =>
    [...reportKeys.all, reportId, "artefacts"] as const,
  signals: (reportId: string) =>
    [...reportKeys.all, reportId, "signals"] as const,
  availableSuggestedReviewers: (authIdentity: string | null) =>
    [
      ...reportKeys.all,
      authIdentity ?? "anonymous",
      "available-reviewers",
    ] as const,
  signalProcessingState: ["inbox", "signal-processing-state"] as const,
};

export function useInboxReports(
  params?: SignalReportsQueryParams,
  options?: {
    enabled?: boolean;
    refetchInterval?: number | false | (() => number | false | undefined);
    refetchIntervalInBackground?: boolean;
    staleTime?: number;
  },
) {
  return useAuthenticatedQuery<SignalReportsResponse>(
    reportKeys.list(params),
    (client) => client.getSignalReports(params),
    options,
  );
}

export function useInboxReportsInfinite(
  params?: SignalReportsQueryParams,
  options?: {
    enabled?: boolean;
    refetchInterval?:
      | number
      | false
      | (() => number | false | undefined)
      | ((query: unknown) => number | false | undefined);
    refetchIntervalInBackground?: boolean;
    staleTime?: number;
  },
) {
  const query = useAuthenticatedInfiniteQuery<SignalReportsResponse, number>(
    reportKeys.infiniteList(params),
    (client, offset) =>
      client.getSignalReports({
        ...params,
        limit: REPORTS_PAGE_SIZE,
        offset,
      }),
    {
      enabled: options?.enabled,
      initialPageParam: 0,
      getNextPageParam: (lastPage, allPages) => {
        const loaded = allPages.reduce((n, p) => n + p.results.length, 0);
        return loaded < lastPage.count ? loaded : undefined;
      },
      refetchInterval: options?.refetchInterval,
      refetchIntervalInBackground: options?.refetchIntervalInBackground,
      staleTime: options?.staleTime,
    },
  );

  const allReports = useMemo(
    () => query.data?.pages.flatMap((p) => p.results) ?? [],
    [query.data?.pages],
  );

  const totalCount = query.data?.pages[0]?.count ?? 0;

  return { ...query, allReports, totalCount };
}

export function useInboxAvailableSuggestedReviewers(options?: {
  enabled?: boolean;
  staleTime?: number;
  query?: string;
}) {
  const authState = useAuthStateValue((state) => state);
  const authIdentity = getAuthIdentity(authState);
  const reviewerQuery = options?.query?.trim() ?? "";
  const shouldUseCachedBaseList = reviewerQuery.length === 0;
  const cachedEntry = useInboxAvailableSuggestedReviewersStore((state) =>
    shouldUseCachedBaseList
      ? state.getReviewersForAuthIdentity(authIdentity)
      : null,
  );
  const setReviewersForAuthIdentity = useInboxAvailableSuggestedReviewersStore(
    (state) => state.setReviewersForAuthIdentity,
  );

  const query = useAuthenticatedQuery<AvailableSuggestedReviewersResponse>(
    reportKeys.availableSuggestedReviewers(
      authIdentity ? `${authIdentity}:${reviewerQuery}` : null,
    ),
    (client) => client.getAvailableSuggestedReviewers(reviewerQuery),
    {
      enabled: !!authIdentity && (options?.enabled ?? true),
      staleTime: options?.staleTime ?? 5 * 60 * 1000,
      refetchOnMount: "always",
      refetchInterval: 60_000,
      refetchIntervalInBackground: true,
      placeholderData:
        shouldUseCachedBaseList && cachedEntry
          ? {
              results: cachedEntry.reviewers,
              count: cachedEntry.reviewers.length,
            }
          : undefined,
    },
  );

  useEffect(() => {
    if (!authIdentity || !query.data || !shouldUseCachedBaseList) {
      return;
    }

    setReviewersForAuthIdentity(authIdentity, query.data.results);
  }, [
    authIdentity,
    query.data,
    setReviewersForAuthIdentity,
    shouldUseCachedBaseList,
  ]);

  return query;
}

export function useInboxSignalProcessingState(options?: {
  enabled?: boolean;
  refetchInterval?: number | false | (() => number | false | undefined);
  refetchIntervalInBackground?: boolean;
  staleTime?: number;
}) {
  return useAuthenticatedQuery<SignalProcessingStateResponse>(
    reportKeys.signalProcessingState,
    (client) => client.getSignalProcessingState(),
    options,
  );
}

export function useInboxReportById(
  reportId: string | null,
  options?: {
    enabled?: boolean;
    refetchInterval?: number | false | (() => number | false | undefined);
    refetchIntervalInBackground?: boolean;
    staleTime?: number;
  },
) {
  return useAuthenticatedQuery<SignalReport | null>(
    reportKeys.detail(reportId ?? ""),
    (client) => client.getSignalReport(reportId ?? ""),
    {
      enabled: !!reportId && (options?.enabled ?? true),
      refetchInterval: options?.refetchInterval,
      refetchIntervalInBackground: options?.refetchIntervalInBackground,
      staleTime: options?.staleTime,
    },
  );
}

export function useInboxReportArtefacts(
  reportId: string,
  options?: { enabled?: boolean },
) {
  return useAuthenticatedQuery<SignalReportArtefactsResponse>(
    reportKeys.artefacts(reportId),
    (client) => client.getSignalReportArtefacts(reportId),
    { enabled: !!reportId && (options?.enabled ?? true) },
  );
}

export function useInboxReportSignals(
  reportId: string,
  options?: { enabled?: boolean },
) {
  return useAuthenticatedQuery<SignalReportSignalsResponse>(
    reportKeys.signals(reportId),
    (client) => client.getSignalReportSignals(reportId),
    { enabled: !!reportId && (options?.enabled ?? true) },
  );
}

interface UpdateSuggestedReviewersVariables {
  artefactId: string;
  content: SuggestedReviewerWriteEntry[];
  optimisticReviewers: SuggestedReviewersArtefact["content"];
}

export function useUpdateSuggestedReviewers(reportId: string) {
  const queryClient = useQueryClient();
  const queryKey = reportKeys.artefacts(reportId);

  return useAuthenticatedMutation<
    SuggestedReviewersArtefact,
    Error,
    UpdateSuggestedReviewersVariables
  >(
    (client, { artefactId, content }) =>
      client.updateSignalReportArtefact(reportId, artefactId, content),
    {
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
                ? ({
                    ...artefact,
                    content: optimisticReviewers,
                  } as SuggestedReviewersArtefact)
                : artefact,
            ),
          });
        }

        return { previous };
      },
      onError: (error, _variables, context) => {
        const previous = (
          context as { previous?: SignalReportArtefactsResponse }
        )?.previous;
        if (previous) {
          queryClient.setQueryData(queryKey, previous);
        }
        toast.error(error.message || "Failed to update suggested reviewers");
      },
      onSettled: () => {
        queryClient.invalidateQueries({ queryKey });
      },
    },
  );
}
