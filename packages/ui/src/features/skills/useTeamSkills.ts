import { TEAM_SKILLS_SERVICE } from "@posthog/core/skills/identifiers";
import type { TeamSkillsService } from "@posthog/core/skills/teamSkillsService";
import { useService } from "@posthog/di/react";
import type { SkillInfo } from "@posthog/shared";
import { useAuthenticatedQuery } from "@posthog/ui/hooks/useAuthenticatedQuery";
import { useMemo } from "react";

export const teamSkillsKeys = {
  list: (localNames: string[]) => ["team-skills", "list", localNames] as const,
  detail: (name: string) => ["team-skills", "detail", name] as const,
  file: (name: string, path: string) =>
    ["team-skills", "file", name, path] as const,
};

export function useTeamSkills(localSkills: SkillInfo[]) {
  const service = useService<TeamSkillsService>(TEAM_SKILLS_SERVICE);
  const localNames = useMemo(
    () => [...new Set(localSkills.map((s) => s.name))].sort(),
    [localSkills],
  );
  return useAuthenticatedQuery(
    teamSkillsKeys.list(localNames),
    (client) => service.listTeamSkills(client, localNames),
    { staleTime: 60_000, retry: false },
  );
}

export function useTeamSkillDetail(name: string | null) {
  return useAuthenticatedQuery(
    teamSkillsKeys.detail(name ?? ""),
    (client) => client.getLlmSkillByName(name ?? ""),
    { enabled: name !== null, staleTime: 60_000, retry: false },
  );
}

export function useTeamSkillFile(name: string, filePath: string | null) {
  return useAuthenticatedQuery(
    teamSkillsKeys.file(name, filePath ?? ""),
    (client) => client.getLlmSkillFile(name, filePath ?? ""),
    { enabled: filePath !== null, staleTime: 60_000, retry: false },
  );
}
