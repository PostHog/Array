// EXPERIMENT (shared-widgets): loads the PostHog webapp's embeddable widget
// bundle (built from posthog/frontend/src/widgets) into this document exactly
// once. The bundle carries its own React 18 + kea and renders into a shadow
// root — same-document, no iframe. See the experiment notes in the PR.

export interface QueryEditorWidgetHandle {
  update(props: {
    query?: unknown;
    onQueryChange?: (query: Record<string, unknown>) => void;
    theme?: "light" | "dark";
  }): void;
  unmount(): void;
}

export interface PostHogWidgetsApi {
  mountQueryEditor(
    el: HTMLElement,
    options: {
      query: unknown;
      onQueryChange?: (query: Record<string, unknown>) => void;
      apiHost: string;
      getAccessToken?: () => Promise<string | null>;
      personalApiKey?: string;
      theme?: "light" | "dark";
      onClose?: () => void;
    },
  ): QueryEditorWidgetHandle;
}

declare global {
  interface Window {
    PostHogWidgets?: PostHogWidgetsApi;
  }
}

const WIDGETS_URL_STORAGE_KEY = "posthog.notebooks.widgetsUrl";

/**
 * Experiment toggle: the widget editor activates only when a bundle URL is set,
 * e.g. localStorage.setItem("posthog.notebooks.widgetsUrl",
 * "http://localhost:8124/widgets.js"). Remove the key to fall back to the
 * generic JSON props editor.
 */
export function getNotebookWidgetsUrl(): string | null {
  try {
    return window.localStorage.getItem(WIDGETS_URL_STORAGE_KEY);
  } catch {
    return null;
  }
}

let widgetsPromise: Promise<PostHogWidgetsApi> | null = null;

export function loadPostHogWidgets(url: string): Promise<PostHogWidgetsApi> {
  if (!widgetsPromise) {
    widgetsPromise = import(/* @vite-ignore */ url).then(() => {
      const api = window.PostHogWidgets;
      if (!api) {
        throw new Error(
          "Widget bundle loaded but window.PostHogWidgets is missing",
        );
      }
      return api;
    });
    widgetsPromise.catch(() => {
      // Allow a retry after a failed load (dev server not running yet, etc.).
      widgetsPromise = null;
    });
  }
  return widgetsPromise;
}
