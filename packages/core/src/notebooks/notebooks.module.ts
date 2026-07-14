import { ContainerModule } from "inversify";
import { NOTEBOOKS_SERVICE } from "./identifiers";
import { NotebooksService } from "./notebooksService";

// Host-agnostic notebooks service (PostHog cloud Notebooks REST API). It only
// needs AuthService + fetch, so it lives in @posthog/core and any host
// (desktop, web, mobile) can bind it by loading this module.
export const notebooksCoreModule = new ContainerModule(({ bind }) => {
  bind(NotebooksService).toSelf().inSingletonScope();
  bind(NOTEBOOKS_SERVICE).toService(NotebooksService);
});
