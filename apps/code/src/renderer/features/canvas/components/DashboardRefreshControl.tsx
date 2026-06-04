import { useDashboard } from "@features/canvas/hooks/useDashboards";
import { useIsDashboardEditing } from "@features/canvas/stores/dashboardEditStore";
import { ArrowClockwiseIcon, GearSixIcon } from "@phosphor-icons/react";
import {
  Button,
  ButtonGroup,
  ButtonGroupSeparator,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@posthog/quill";
import { useTRPC } from "@renderer/trpc/client";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";

const POLL_OPTIONS = { "10s": 10_000, "10min": 600_000 } as const;
type RefreshMode = "static" | keyof typeof POLL_OPTIONS;

function formatCountdown(intervalMs: number, secondsLeft: number): string {
  if (intervalMs >= 60_000) {
    const m = Math.floor(secondsLeft / 60);
    const s = secondsLeft % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }
  return `${secondsLeft}s`;
}

// Refresh + polling control for a dashboard. Static = manual refresh only;
// polling refetches on an interval and counts down in the main button. Polling
// is paused while the dashboard is being edited so the data stays put.
export function DashboardRefreshControl({
  dashboardId,
}: {
  dashboardId: string;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const editing = useIsDashboardEditing(dashboardId);
  const { isFetching } = useDashboard(dashboardId);

  const [mode, setMode] = useState<RefreshMode>("static");
  const intervalMs = mode === "static" ? null : POLL_OPTIONS[mode];
  const polling = intervalMs != null && !editing;
  const [secondsLeft, setSecondsLeft] = useState(0);

  const refetch = useCallback(() => {
    void queryClient.invalidateQueries(trpc.dashboards.get.pathFilter());
  }, [queryClient, trpc]);

  useEffect(() => {
    if (!polling || intervalMs == null) return;
    setSecondsLeft(Math.round(intervalMs / 1000));
    const id = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          refetch();
          return Math.round(intervalMs / 1000);
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [polling, intervalMs, refetch]);

  const label =
    intervalMs == null
      ? "Refresh"
      : editing
        ? "Paused"
        : `Refreshing in ${formatCountdown(intervalMs, secondsLeft)}`;

  return (
    <ButtonGroup>
      <Button variant="outline" size="sm" onClick={refetch}>
        <ArrowClockwiseIcon
          size={14}
          className={isFetching ? "motion-safe:animate-spin" : undefined}
        />
        {label}
      </Button>
      <ButtonGroupSeparator />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="outline" size="sm" aria-label="Refresh options">
              <GearSixIcon size={14} />
            </Button>
          }
        />
        <DropdownMenuContent
          align="end"
          sideOffset={6}
          className="min-w-[160px]"
        >
          <DropdownMenuRadioGroup
            value={mode}
            onValueChange={(value) => setMode(value as RefreshMode)}
          >
            <DropdownMenuRadioItem value="static">Static</DropdownMenuRadioItem>
            <DropdownMenuGroup>
              <DropdownMenuLabel>Polling</DropdownMenuLabel>
              <DropdownMenuRadioItem value="10s">10s</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="10min">10min</DropdownMenuRadioItem>
            </DropdownMenuGroup>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </ButtonGroup>
  );
}
