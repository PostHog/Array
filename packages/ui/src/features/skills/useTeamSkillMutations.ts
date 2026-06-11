import { TEAM_SKILLS_SERVICE } from "@posthog/core/skills/identifiers";
import type { TeamSkillsService } from "@posthog/core/skills/teamSkillsService";
import { useService } from "@posthog/di/react";
import { useHostTRPC, useHostTRPCClient } from "@posthog/host-router/react";
import { useAuthenticatedMutation } from "@posthog/ui/hooks/useAuthenticatedMutation";
import { useQueryClient } from "@tanstack/react-query";

/** Publishes a local user/repo skill to the team as a new LLMSkill version. */
export function usePublishSkill() {
  const service = useService<TeamSkillsService>(TEAM_SKILLS_SERVICE);
  const hostClient = useHostTRPCClient();
  const queryClient = useQueryClient();
  return useAuthenticatedMutation(
    async (client, variables: { skillPath: string }) => {
      const exported = await hostClient.skills.export.query({
        skillPath: variables.skillPath,
      });
      const { version } = await service.publishSkill(client, exported);
      return { version, skipped: exported.skipped };
    },
    {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: ["team-skills"] });
      },
    },
  );
}

/** Materializes a team skill into ~/.claude/skills (copy-and-forget). */
export function useInstallTeamSkill() {
  const service = useService<TeamSkillsService>(TEAM_SKILLS_SERVICE);
  const hostClient = useHostTRPCClient();
  const trpc = useHostTRPC();
  const queryClient = useQueryClient();
  return useAuthenticatedMutation(
    async (client, variables: { name: string; overwrite?: boolean }) => {
      const skill = await service.fetchSkillForInstall(client, variables.name);
      return hostClient.skills.installTeamSkill.mutate({
        ...skill,
        overwrite: variables.overwrite ?? false,
      });
    },
    {
      onSuccess: () => {
        void queryClient.invalidateQueries(trpc.skills.pathFilter());
        void queryClient.invalidateQueries({ queryKey: ["team-skills"] });
      },
    },
  );
}
