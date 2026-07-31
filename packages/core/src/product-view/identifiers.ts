// DI token for the Product View orchestration service. Lives in @posthog/core
// so host-router routers and the host DI container can reference it without
// depending on the desktop main process (where the service is bound).
export const PRODUCT_VIEW_SERVICE = Symbol.for(
  "posthog.core.productView.service",
);
