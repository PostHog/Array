import { registerRendererStateStorage } from "@posthog/ui/shell/rendererStorage";

// The web host does not persist UI state yet. Without a registered backend,
// persisted stores would wait forever and _hasHydrated would never flip,
// which blocks hydration-gated features like draft saving. The null backend
// completes hydration with defaults, matching web behavior before the
// registration seam. Swap in window.localStorage to enable persistence.
registerRendererStateStorage({
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
});
