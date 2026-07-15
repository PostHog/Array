import { ContainerModule } from "inversify";
import { NOTEBOOK_NODE_AI_SERVICE, NOTEBOOKS_SERVICE } from "./identifiers";
import {
  NOTEBOOK_NODE_AI_MODEL,
  PostHogNotebookNodeAIModel,
} from "./notebookNodeAIModel";
import { NotebookNodeAIService } from "./notebookNodeAIService";
import { NotebooksService } from "./notebooksService";

// Host-agnostic notebooks service (PostHog cloud Notebooks REST API). It only
// needs AuthService + fetch, so it lives in @posthog/core and any host
// (desktop, web, mobile) can bind it by loading this module.
export const notebooksCoreModule = new ContainerModule(({ bind }) => {
  bind(NotebooksService).toSelf().inSingletonScope();
  bind(NOTEBOOKS_SERVICE).toService(NotebooksService);
  bind(NOTEBOOK_NODE_AI_MODEL)
    .to(PostHogNotebookNodeAIModel)
    .inSingletonScope();
  bind(NotebookNodeAIService).toSelf().inSingletonScope();
  bind(NOTEBOOK_NODE_AI_SERVICE).toService(NotebookNodeAIService);
});
