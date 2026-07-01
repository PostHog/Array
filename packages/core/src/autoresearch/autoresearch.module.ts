import { ContainerModule } from "inversify";
import { AutoresearchService } from "./autoresearch";
import { AUTORESEARCH_SERVICE } from "./identifiers";

export const autoresearchCoreModule = new ContainerModule(({ bind }) => {
  bind(AUTORESEARCH_SERVICE).to(AutoresearchService).inSingletonScope();
});
