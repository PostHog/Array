import { ContainerModule } from "inversify";
import { SKILLS_SERVICE } from "./identifiers";
import { SkillsService } from "./skills";

export const skillsModule = new ContainerModule(({ bind }) => {
  bind(SKILLS_SERVICE).to(SkillsService).inSingletonScope();
});
