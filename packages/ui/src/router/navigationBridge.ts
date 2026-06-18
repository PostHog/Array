import { ANALYTICS_EVENTS } from "@posthog/shared";
import type { SettingsCategory } from "@posthog/ui/features/settings/types";
import { track } from "@posthog/ui/shell/analytics";
import { getRouterOrNull } from "./routerRef";

// This bridge isolates imperative router calls behind a stable API and, by
// reaching the router through `routerRef` (a leaf module) rather than importing
// `./router` directly, keeps itself out of the route-tree import cycle:
//   router.ts → routeTree.gen.ts → __root.tsx → hooks → navigationBridge
// A static `import { router }` here would close that loop and break code-split
// route chunks (TDZ on `rootRouteImport`). See routerRef.ts.
//
// Every call degrades to a no-op / empty read when the router isn't mounted yet
// (early boot, unit tests). These are renderer conveniences — they must never
// throw just because the router singleton hasn't been created.

export function navigateToCode(): void {
  void getRouterOrNull()?.navigate({ to: "/code" });
}

export function navigateToTaskDetail(taskId: string): void {
  void getRouterOrNull()?.navigate({
    to: "/code/tasks/$taskId",
    params: { taskId },
  });
}

export function navigateToTaskPending(key: string): void {
  void getRouterOrNull()?.navigate({
    to: "/code/tasks/pending/$key",
    params: { key },
  });
}

export function navigateToChannel(channelId: string): void {
  void getRouterOrNull()?.navigate({
    to: "/website/$channelId",
    params: { channelId },
  });
}

export function navigateToChannelTask(channelId: string, taskId: string): void {
  void getRouterOrNull()?.navigate({
    to: "/website/$channelId/tasks/$taskId",
    params: { channelId, taskId },
  });
}

export function navigateToFolderSettings(folderId: string): void {
  void getRouterOrNull()?.navigate({
    to: "/folders/$folderId",
    params: { folderId },
  });
}

export function navigateToHome(): void {
  void getRouterOrNull()?.navigate({ to: "/code/home" });
}

export function navigateToInbox(): void {
  void getRouterOrNull()?.navigate({ to: "/code/inbox" });
}

export function navigateToInboxPullRequestDetail(reportId: string): void {
  void getRouterOrNull()?.navigate({
    to: "/code/inbox/pulls/$reportId",
    params: { reportId },
  });
}

export function navigateToInboxReportDetail(reportId: string): void {
  void getRouterOrNull()?.navigate({
    to: "/code/inbox/reports/$reportId",
    params: { reportId },
  });
}

export function navigateToScoutDetail(
  skillSlug: string,
  findingId?: string,
): void {
  void getRouterOrNull()?.navigate({
    to: "/code/agents/scouts/$skillName",
    params: { skillName: skillSlug },
    search: findingId ? { finding: findingId } : {},
  });
}

export function navigateToAgents(): void {
  void getRouterOrNull()?.navigate({ to: "/code/agents" });
}

export function navigateToArchived(): void {
  void getRouterOrNull()?.navigate({ to: "/code/archived" });
}

export function navigateToCommandCenter(): void {
  void getRouterOrNull()?.navigate({ to: "/command-center" });
  // Parity with the pre-router navigationStore.navigateToCommandCenter action,
  // which emitted this event; the route component does not track it.
  track(ANALYTICS_EVENTS.COMMAND_CENTER_VIEWED);
}

export function navigateToSkills(): void {
  void getRouterOrNull()?.navigate({ to: "/skills" });
}

export function navigateToMcpServers(): void {
  void getRouterOrNull()?.navigate({ to: "/mcp-servers" });
}

// Channels-space mirrors. These render the same shared views as their /code (or
// top-level) counterparts but under /website, so navigating from the channels
// sidebar keeps the channels chrome instead of switching back to Code. The
// SidebarNavSection picks the right variant based on the active space.

export function navigateToWebsiteNew(): void {
  void getRouterOrNull()?.navigate({ to: "/website/new" });
}

export function navigateToWebsiteHome(): void {
  void getRouterOrNull()?.navigate({ to: "/website/home" });
}

export function navigateToWebsiteSkills(): void {
  void getRouterOrNull()?.navigate({ to: "/website/skills" });
}

export function navigateToWebsiteMcpServers(): void {
  void getRouterOrNull()?.navigate({ to: "/website/mcp-servers" });
}

export function navigateToWebsiteCommandCenter(): void {
  void getRouterOrNull()?.navigate({ to: "/website/command-center" });
  // Parity with navigateToCommandCenter's analytics tracking.
  track(ANALYTICS_EVENTS.COMMAND_CENTER_VIEWED);
}

export function navigateToSettings(
  category: SettingsCategory,
  options?: { replace?: boolean },
): void {
  void getRouterOrNull()?.navigate({
    to: "/settings/$category",
    params: { category },
    // Switching categories within settings should replace, not stack, so a
    // single history.back() (closeSettings) exits to the app rather than
    // walking back through every category that was visited.
    replace: options?.replace,
  });
}

export function isOnSettingsRoute(): boolean {
  return (
    getRouterOrNull()?.state.matches.some((m) =>
      m.routeId.startsWith("/settings"),
    ) ?? false
  );
}

export function goBackInHistory(): void {
  getRouterOrNull()?.history.back();
}

// False when the current entry is the first in the session history (index 0),
// e.g. after a quit+reopen restores a deep route directly. In that case
// `history.back()` is a no-op and callers should navigate to a fallback route.
export function canGoBackInHistory(): boolean {
  return getRouterOrNull()?.history.canGoBack() ?? false;
}

export function goForwardInHistory(): void {
  getRouterOrNull()?.history.forward();
}

// Accessors for code that needs to read router state outside of React (e.g.
// Zustand actions, imperative event handlers). Components should prefer the
// `useRouterState` hook from `@tanstack/react-router`.
export function getCurrentMatches() {
  return getRouterOrNull()?.state.matches ?? [];
}

export function getCurrentLocation() {
  return getRouterOrNull()?.state.location ?? null;
}

export function subscribeToRouterResolved(handler: () => void): () => void {
  const router = getRouterOrNull();
  if (!router) return () => {};
  return router.subscribe("onResolved", handler);
}
