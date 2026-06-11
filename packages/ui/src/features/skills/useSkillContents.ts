import { useHostTRPC } from "@posthog/host-router/react";
import { useQuery } from "@tanstack/react-query";

export function useSkillContents(skillPath: string) {
  const trpc = useHostTRPC();
  return useQuery(
    trpc.skills.contents.queryOptions({ skillPath }, { staleTime: 30_000 }),
  );
}

export function useSkillFile(skillPath: string, filePath: string | null) {
  const trpc = useHostTRPC();
  return useQuery(
    trpc.skills.readFile.queryOptions(
      { skillPath, filePath: filePath ?? "" },
      { enabled: filePath !== null, staleTime: 30_000 },
    ),
  );
}
