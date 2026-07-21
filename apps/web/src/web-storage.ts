import { registerRendererStateStorage } from "@posthog/ui/shell/rendererStorage";

// Web persistence backend for @posthog/ui stores (drafts, settings, layout).
// Desktop persists through the host; web uses origin-scoped localStorage.
registerRendererStateStorage({
  getItem: (name) => window.localStorage.getItem(name),
  setItem: (name, value) => {
    window.localStorage.setItem(name, value);
  },
  removeItem: (name) => {
    window.localStorage.removeItem(name);
  },
});
