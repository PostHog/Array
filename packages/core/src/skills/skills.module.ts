import { ContainerModule } from "inversify";
import { SKILL_GENERATOR_SERVICE, TEAM_SKILLS_SERVICE } from "./identifiers";
import { SkillGeneratorService } from "./skillGeneratorService";
import { TeamSkillsService } from "./teamSkillsService";

export const skillsCoreModule = new ContainerModule(({ bind }) => {
  bind(TEAM_SKILLS_SERVICE).to(TeamSkillsService).inSingletonScope();
  bind(SKILL_GENERATOR_SERVICE).to(SkillGeneratorService).inSingletonScope();
});
