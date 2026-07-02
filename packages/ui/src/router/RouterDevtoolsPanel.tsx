import { lazy, Suspense } from "react";
import { router } from "./router";

// The router devtools panel, embedded (manual mode) rather than rendered with
// its own floating trigger — the dev toolbar owns the trigger and the panel
// chrome. The panel receives the app `router` explicitly because the dev
// toolbar is mounted as a sibling of the RouterProvider, so it is outside the
// router's React context.
//
// Dynamic import behind an `import.meta.env.DEV` gate keeps the devtools chunk
// out of the production bundle: the constant folds at build time, so the branch
// (and its import target) is eliminated from prod builds entirely.
const LazyRouterDevtoolsPanel = import.meta.env.DEV
  ? lazy(async () => {
      const { TanStackRouterDevtoolsPanel } = await import(
        "@tanstack/react-router-devtools"
      );
      return {
        default: () => (
          <TanStackRouterDevtoolsPanel
            router={router}
            style={{ height: "100%", width: "100%" }}
          />
        ),
      };
    })
  : () => null;

export function RouterDevtoolsPanel() {
  return (
    <Suspense fallback={null}>
      <LazyRouterDevtoolsPanel />
    </Suspense>
  );
}
