// DI token for the notebooks service. Lives beside the interface in
// @posthog/core so host routers and containers can reference it without
// importing the concrete class's module.
export const NOTEBOOKS_SERVICE = Symbol.for("posthog.notebooks.service");

// AI summarizer + change-request engine for notebook component nodes (the
// model-transport token lives beside its interface in notebookNodeAIModel.ts).
export const NOTEBOOK_NODE_AI_SERVICE = Symbol.for(
  "posthog.notebooks.nodeAIService",
);
