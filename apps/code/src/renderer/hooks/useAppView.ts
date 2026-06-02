import { useTaskInputPrefillStore } from "@features/task-detail/stores/taskInputPrefillStore";
import { getCurrentMatches } from "@renderer/navigationBridge";
import type { Task } from "@shared/types";
import { useRouterState } from "@tanstack/react-router";
import { getCachedTask } from "@utils/queryClient";
import { useMemo } from "react";

export type AppViewType =
  | "task-detail"
  | "task-pending"
  | "task-input"
  | "folder-settings"
  | "inbox"
  | "archived"
  | "command-center"
  | "skills"
  | "mcp-servers"
  | "settings";

export interface TaskInputReportAssociation {
  reportId: string;
  title: string;
}

export interface AppView {
  type: AppViewType;
  data?: Task;
  taskId?: string;
  folderId?: string;
  pendingTaskKey?: string;
  taskInputRequestId?: string;
  initialPrompt?: string;
  initialCloudRepository?: string;
  initialModel?: string;
  initialMode?: string;
  reportAssociation?: TaskInputReportAssociation;
}

type Match = { routeId: string; params: Record<string, string | undefined> };

function deriveFromMatches(matches: Match[]): AppView {
  const last = matches[matches.length - 1];
  if (!last) return { type: "task-input" };

  switch (last.routeId) {
    case "/code/tasks/$taskId": {
      const taskId = last.params.taskId;
      if (!taskId) return { type: "task-input" };
      return { type: "task-detail", taskId, data: getCachedTask(taskId) };
    }
    case "/code/tasks/pending/$key":
      return { type: "task-pending", pendingTaskKey: last.params.key };
    case "/folders/$folderId":
      return { type: "folder-settings", folderId: last.params.folderId };
    case "/code/inbox":
      return { type: "inbox" };
    case "/code/archived":
      return { type: "archived" };
    case "/command-center":
      return { type: "command-center" };
    case "/skills":
      return { type: "skills" };
    case "/mcp-servers":
      return { type: "mcp-servers" };
    case "/settings/$category":
    case "/settings/":
      return { type: "settings" };
    default:
      return { type: "task-input" };
  }
}

/**
 * Single source of truth for the current view. Replaces the
 * pre-router `useNavigationStore((s) => s.view)` pattern.
 *
 * The returned object is memoized on the route's primitive values so its
 * identity is stable across unrelated re-renders. This matters: the old
 * navigationStore handed out a stable `view` reference, and consumers depend on
 * `[view]` in effects/memos. Returning a fresh object every render turns any
 * such effect into an infinite loop (e.g. SidebarMenu → markViewed → cache
 * write → re-render → repeat), which starves the UI thread.
 */
export function useAppView(): AppView {
  const last = useRouterState({
    select: (s) => {
      const m = s.matches[s.matches.length - 1];
      return m
        ? {
            routeId: m.routeId,
            params: m.params as Record<string, string | undefined>,
          }
        : null;
    },
  });
  const prefill = useTaskInputPrefillStore((s) => s.prefill);

  const routeId = last?.routeId ?? "";
  const taskId = last?.params.taskId;
  const pendingKey = last?.params.key;
  const folderId = last?.params.folderId;

  return useMemo(() => {
    // Rebuild the match from primitives so the memo depends only on stable
    // values — the `last` selector returns a fresh object every render.
    const match = routeId
      ? { routeId, params: { taskId, key: pendingKey, folderId } }
      : null;
    const view = deriveFromMatches(match ? [match] : []);

    // /code/ → merge prefill so the TaskInput screen surfaces transient fields.
    if (view.type === "task-input") {
      return {
        ...view,
        folderId: prefill.folderId,
        initialPrompt: prefill.initialPrompt,
        initialCloudRepository: prefill.initialCloudRepository,
        initialModel: prefill.initialModel,
        initialMode: prefill.initialMode,
        reportAssociation: prefill.reportAssociation,
        taskInputRequestId: prefill.requestId,
      };
    }
    return view;
  }, [routeId, taskId, pendingKey, folderId, prefill]);
}

/**
 * Read the current view outside React (event handlers, imperative code).
 * Components should prefer `useAppView()` for proper subscription.
 */
export function getAppViewSnapshot(): AppView {
  const matches = getCurrentMatches() as unknown as Match[];
  return deriveFromMatches(matches);
}
