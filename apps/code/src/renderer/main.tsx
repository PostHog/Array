import "reflect-metadata";
// Side effect: registers the host (electron-trpc-backed) storage with @posthog/ui.
// Persisted stores hydrate from it once it registers, wherever in the import
// graph they are created.
import "@utils/electronStorage";
// Side effect: composes the renderer container and calls setRootContainer.
// Must precede the updates adapter below, which resolves UPDATES_CLIENT at
// module scope.
import "@renderer/di/container";
// Side effect: drives the updates subscription + toast via the core update store.
import "@renderer/platform-adapters/updates";
// Side effect: attaches window focus/visibility listeners so `focused` is accurate before inbox queries mount.
import "@posthog/ui/shell/rendererWindowFocusStore";
import { Providers } from "@components/Providers";
import { preloadHighlighter } from "@pierre/diffs";
import { boot } from "@posthog/di/contribution";
import { ServiceProvider } from "@posthog/di/react";
import App from "@posthog/ui/shell/App";
import { initializePostHog } from "@posthog/ui/shell/posthogAnalyticsImpl";
import { registerDesktopContributions } from "@renderer/desktop-contributions";
import { container } from "@renderer/di/container";
import "@renderer/desktop-services";
import React from "react";
import ReactDOM from "react-dom/client";
import "@posthog/ui/styles/globals.css";

void preloadHighlighter({
  themes: ["github-dark", "github-light"],
  langs: [
    "typescript",
    "tsx",
    "javascript",
    "jsx",
    "json",
    "css",
    "html",
    "markdown",
    "python",
    "ruby",
    "go",
    "rust",
    "shell",
    "yaml",
    "sql",
  ],
});

// HACK(@posthog/hedgehog-mode): The package bundles react-dom 18 code that
// accesses React 18 internals at module scope. React 19 moved these to
// __CLIENT_INTERNALS and removed the old names. Shim the old structure so the
// bundled code doesn't crash on import.
// Remove once hedgehog-mode ships a React 19 compatible build.
{
  const r = React as unknown as Record<string, unknown>;
  if (!r.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED) {
    r.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED = {};
  }
  const internals =
    r.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED as Record<
      string,
      unknown
    >;
  if (!internals.ReactCurrentDispatcher) {
    internals.ReactCurrentDispatcher = { current: null };
  }
  if (!internals.ReactCurrentOwner) {
    internals.ReactCurrentOwner = { current: null };
  }
  if (!internals.ReactDebugCurrentFrame) {
    internals.ReactDebugCurrentFrame = { getCurrentStack: null };
  }
}

document.title = import.meta.env.DEV
  ? "PostHog Code (Development)"
  : "PostHog Code";

const bootstrapSessionId = window.__posthogBootstrap?.sessionId;
if (bootstrapSessionId) {
  initializePostHog(bootstrapSessionId);
}

registerDesktopContributions();
void boot(container);

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element not found");

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <ServiceProvider container={container}>
      <Providers>
        <App />
      </Providers>
    </ServiceProvider>
  </React.StrictMode>,
);
