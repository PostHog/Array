import { publicProcedure, router } from "@posthog/host-trpc/trpc";
import { SKILLS_SERVICE } from "@posthog/workspace-server/services/skills/identifiers";
import {
  listSkillsOutput,
  readSkillFileInput,
  readSkillFileOutput,
  skillContentsInput,
  skillContentsOutput,
} from "@posthog/workspace-server/services/skills/schemas";
import type { SkillsService } from "@posthog/workspace-server/services/skills/skills";

export const skillsRouter = router({
  list: publicProcedure
    .output(listSkillsOutput)
    .query(({ ctx }) =>
      ctx.container.get<SkillsService>(SKILLS_SERVICE).listSkills(),
    ),
  contents: publicProcedure
    .input(skillContentsInput)
    .output(skillContentsOutput)
    .query(({ ctx, input }) =>
      ctx.container
        .get<SkillsService>(SKILLS_SERVICE)
        .getSkillContents(input.skillPath),
    ),
  readFile: publicProcedure
    .input(readSkillFileInput)
    .output(readSkillFileOutput)
    .query(({ ctx, input }) =>
      ctx.container
        .get<SkillsService>(SKILLS_SERVICE)
        .readSkillFile(input.skillPath, input.filePath),
    ),
});
