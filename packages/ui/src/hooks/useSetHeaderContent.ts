import { useHeaderStore, usePaneId } from "@posthog/ui/shell/headerStore";
import { type ReactNode, useLayoutEffect } from "react";

export function useSetHeaderContent(content: ReactNode) {
  const paneId = usePaneId();
  const setContent = useHeaderStore((state) => state.setContent);

  useLayoutEffect(() => {
    if (!paneId) return;
    setContent(paneId, content);

    return () => {
      setContent(paneId, null);
    };
  }, [paneId, content, setContent]);
}
