// DI token for the notebooks service. Lives beside the interface in
// @posthog/core so host routers and containers can reference it without
// importing the concrete class's module.
export const NOTEBOOKS_SERVICE = Symbol.for("posthog.notebooks.service");
