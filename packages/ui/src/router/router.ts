import {
  createHashHistory,
  createRouter as createTanStackRouter,
} from "@tanstack/react-router";
import { RouteNotFound } from "./RouteNotFound";
import { RoutePending } from "./RoutePending";
import { setRouter } from "./routerRef";
import { routeTree } from "./routeTree.gen";

const LAST_ROUTE_KEY = "code:last-route-hash";

// Cold-boot URL restore: Electron's BrowserWindow.loadFile resets the URL
// hash, so a quit + relaunch loses the user's last route. localStorage is
// sync, so we can read the persisted hash before the router parses location.
// Without this the user sees a TaskInput flash before the route hydrates.
if (typeof window !== "undefined" && !window.location.hash) {
  try {
    const last = window.localStorage.getItem(LAST_ROUTE_KEY);
    if (last && last !== "#" && last !== "#/") {
      window.location.hash = last;
    }
  } catch {
    // localStorage may throw in restricted contexts; safe to ignore.
  }
}

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

// Persist current hash on every navigation so we can restore it next boot.
if (typeof window !== "undefined") {
  router.subscribe("onResolved", () => {
    try {
      const hash = window.location.hash;
      if (hash && hash !== "#" && hash !== "#/") {
        window.localStorage.setItem(LAST_ROUTE_KEY, hash);
      }
    } catch {
      // Ignore localStorage failures.
    }
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
