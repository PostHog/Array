import { useSettingsPageStore } from "@features/settings/stores/settingsPageStore";
import type { SettingsCategory } from "@features/settings/types";
import * as nav from "@renderer/navigationBridge";
import { useRouterState } from "@tanstack/react-router";
import { useCallback } from "react";

interface SettingsContext {
  repoPath?: string;
}

/**
 * Open the settings page. Optionally pin context (e.g. repoPath for the
 * worktrees page) or fire a one-shot initial action (e.g. "create-new" to
 * open the create-environment form on entry). The store holds these; the
 * URL holds the category.
 */
export function openSettings(
  category: SettingsCategory = "general",
  contextOrAction?: SettingsContext | string,
): void {
  const store = useSettingsPageStore.getState();
  if (typeof contextOrAction === "string") {
    store.setContext({});
    store.setInitialAction(contextOrAction);
  } else {
    store.setContext(contextOrAction ?? {});
    store.setInitialAction(null);
  }
  store.setFormMode(false);
  nav.navigateToSettings(category);
}

/**
 * Close the settings page — returns the user to their prior route via
 * router history. If they came in via a deep link, falls back to /code.
 */
export function closeSettings(): void {
  useSettingsPageStore.getState().reset();
  if (!nav.isOnSettingsRoute()) return;
  if (nav.canGoBackInHistory()) {
    nav.goBackInHistory();
  } else {
    nav.navigateToCode();
  }
}

export function useCloseSettings(): typeof closeSettings {
  return useCallback(closeSettings, []);
}

/**
 * True when the current route is anywhere under `/settings/*`.
 */
export function useIsSettingsOpen(): boolean {
  return useRouterState({
    select: (s) => s.matches.some((m) => m.routeId.startsWith("/settings")),
  });
}
