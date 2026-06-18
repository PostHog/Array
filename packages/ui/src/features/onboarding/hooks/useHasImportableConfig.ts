import { useHostTRPC } from "@posthog/host-router/react";
import { useQuery } from "@tanstack/react-query";

export function useHasImportableConfig(): boolean {
  const trpc = useHostTRPC();
  const { data, isError } = useQuery(
    trpc.onboardingImport.getSummary.queryOptions(undefined, {
      staleTime: 60_000,
    }),
  );
  if (isError) return false;
  return data?.total !== 0;
}
