import { ContainerModule } from "inversify";
import { RECENTS_SERVICE } from "./identifiers";
import { RecentsService } from "./recentsService";

export const recentsCoreModule = new ContainerModule(({ bind }) => {
  bind(RecentsService).toSelf().inSingletonScope();
  bind(RECENTS_SERVICE).toService(RecentsService);
});
