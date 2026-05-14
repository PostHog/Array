import { useTRPC } from "@renderer/trpc";
import { useQuery } from "@tanstack/react-query";
import { normalizeRepositoryLookupKey } from "@utils/repository";

export function useDetectedCloudRepository(
  folderPath: string | null | undefined,
): string | null {
  const trpcReact = useTRPC();
  const { data } = useQuery(
    trpcReact.git.detectRepo.queryOptions(
      { directoryPath: folderPath ?? "" },
      {
        enabled: !!folderPath,
        staleTime: 60_000,
      },
    ),
  );

  if (!data?.organization || !data?.repository) return null;
  return normalizeRepositoryLookupKey(
    `${data.organization}/${data.repository}`,
  );
}
