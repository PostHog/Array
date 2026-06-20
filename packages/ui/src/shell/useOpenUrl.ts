import { useCallback } from "react";
import { usePanelLayoutStore } from "../features/panels/panelLayoutStore";
import { useSessionTaskId } from "../features/sessions/useSessionTaskId";
import { openExternalUrl } from "./openExternal";

const HTTP_RE = /^https?:\/\//i;

export function useOpenUrl(): (url: string) => void {
  const taskId = useSessionTaskId();
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
