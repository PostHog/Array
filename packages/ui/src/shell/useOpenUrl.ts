import { useParams } from "@tanstack/react-router";
import { useCallback } from "react";
import { usePanelLayoutStore } from "../features/panels/panelLayoutStore";
import { useSessionTaskId } from "../features/sessions/useSessionTaskId";
import { openExternalUrl } from "./openExternal";

const HTTP_RE = /^https?:\/\//i;

export function useOpenUrl(): (url: string) => void {
  const sessionTaskId = useSessionTaskId();
  const { taskId: routeTaskId } = useParams({ strict: false });
  const taskId =
    sessionTaskId ?? (typeof routeTaskId === "string" ? routeTaskId : null);
  const openBrowserUrl = usePanelLayoutStore((s) => s.openBrowserUrl);

  return useCallback(
    (url: string) => {
      if (HTTP_RE.test(url) && taskId) {
        openBrowserUrl(taskId, url);
      } else {
        openExternalUrl(url);
      }
    },
    [taskId, openBrowserUrl],
  );
}
