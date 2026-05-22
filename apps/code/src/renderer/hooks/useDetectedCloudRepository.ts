import { useTRPC } from "@renderer/trpc";
import { useQuery } from "@tanstack/react-query";

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
  return `${data.organization}/${data.repository}`.toLowerCase();
}
