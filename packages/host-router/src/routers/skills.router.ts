import { publicProcedure, router } from "@posthog/host-trpc/trpc";
import { SKILLS_SERVICE } from "@posthog/workspace-server/services/skills/identifiers";
import { listSkillsOutput } from "@posthog/workspace-server/services/skills/schemas";
import type { SkillsService } from "@posthog/workspace-server/services/skills/skills";

export const skillsRouter = router({
  list: publicProcedure
    .output(listSkillsOutput)
    .query(({ ctx }) =>
      ctx.container.get<SkillsService>(SKILLS_SERVICE).listSkills(),
    ),
});
