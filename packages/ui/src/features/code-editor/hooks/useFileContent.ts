import { useHostTRPC } from "@posthog/host-router/react";
import { useQuery } from "@tanstack/react-query";

export function useRepoFileContent(
  repoPath: string,
  filePath: string,
  enabled: boolean,
) {
  const trpc = useHostTRPC();
  return useQuery(
    trpc.fs.readRepoFile.queryOptions(
      { repoPath, filePath },
      {
        enabled,
        staleTime: Number.POSITIVE_INFINITY,
      },
    ),
  );
}

export function useAbsoluteFileContent(filePath: string, enabled: boolean) {
  const trpc = useHostTRPC();
  return useQuery(
    trpc.fs.readAbsoluteFile.queryOptions(
      { filePath },
      {
        enabled,
        staleTime: Number.POSITIVE_INFINITY,
      },
    ),
  );
}

export function useFileAsBase64(filePath: string, enabled: boolean) {
  const trpc = useHostTRPC();
  return useQuery(
    trpc.fs.readFileAsBase64.queryOptions(
      { filePath },
      {
        enabled,
        staleTime: Number.POSITIVE_INFINITY,
      },
    ),
  );
}
