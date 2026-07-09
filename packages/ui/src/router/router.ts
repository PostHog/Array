import {
  createHashHistory,
  createRouter as createTanStackRouter,
} from "@tanstack/react-router";
import { RouteNotFound } from "./RouteNotFound";
import { RoutePending } from "./RoutePending";
import { setRouter } from "./routerRef";
import { routeTree } from "./routeTree.gen";

export const router = createTanStackRouter({
  routeTree,
  history: createHashHistory(),
  defaultPreload: "intent",
  // Show the route's pending UI the instant its loader is still resolving, so
  // navigation commits immediately instead of stalling on the previous screen.
  defaultPendingMs: 0,
  defaultPendingComponent: RoutePending,
  defaultNotFoundComponent: RouteNotFound,
  scrollRestoration: false,
});

// Publish the instance to the leaf ref so imperative callers reach it without a
// static import of this module (which would re-create the route-tree cycle).
setRouter(router);

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
