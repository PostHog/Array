import { ChartLineUp } from "@phosphor-icons/react";
import { AUTORESEARCH_SERVICE } from "@posthog/core/autoresearch/identifiers";
import { useServiceOptional } from "@posthog/di/react";
import { Button } from "@posthog/quill";
import { Tooltip } from "../../primitives/Tooltip";
import { usePanelLayoutStore } from "../panels/panelLayoutStore";
import { useActiveAutoresearchRun } from "./useAutoresearchStore";

interface AutoresearchHeaderButtonProps {
  taskId: string;
}

/** Task-header entry point: opens the autoresearch dashboard tab. */
export function AutoresearchHeaderButton({
  taskId,
}: AutoresearchHeaderButtonProps) {
  const service = useServiceOptional(AUTORESEARCH_SERVICE);
  const openAutoresearchTab = usePanelLayoutStore(
    (state) => state.openAutoresearchTab,
  );
  const activeRun = useActiveAutoresearchRun(taskId);
  const isLive =
    activeRun?.status === "running" || activeRun?.status === "paused";

  if (!service) return null;

  return (
    <Tooltip
      content={isLive ? "Autoresearch (running)" : "Autoresearch"}
      side="bottom"
    >
      <Button
        size="icon-sm"
        variant="outline"
        aria-label="Open autoresearch dashboard"
        onClick={() => openAutoresearchTab(taskId)}
        className="relative"
      >
        <ChartLineUp size={16} />
        {isLive && (
          <span className="absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-(--blue-9)" />
        )}
      </Button>
    </Tooltip>
  );
}
