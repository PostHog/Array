import {
  CalendarBlankIcon,
  CaretDownIcon,
  SpinnerGapIcon,
} from "@phosphor-icons/react";
import type { DashboardDateRange } from "@posthog/core/canvas/dashboardSchemas";
import {
  Button,
  DateTimePicker,
  type DateTimeValue,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@posthog/quill";
import {
  formatRangeLabel,
  liveWindow,
  readStoredRange,
  toPickerValue,
} from "@posthog/ui/features/canvas/dateRange";
import { useDashboard } from "@posthog/ui/features/canvas/hooks/useDashboards";
import { useRefreshDashboard } from "@posthog/ui/features/canvas/hooks/useRefreshDashboard";
import {
  useCanvasChatStore,
  useCanvasThread,
} from "@posthog/ui/features/canvas/stores/canvasChatStore";
import { useIsDashboardEditing } from "@posthog/ui/features/canvas/stores/dashboardEditStore";
import { useMemo, useState } from "react";

function threadIdFor(dashboardId: string): string {
  return `dashboard:${dashboardId}`;
}

// The toolbar date picker for a Dashboard / Web-analytics canvas. In VIEW mode it
// re-runs the board's time-based queries for the picked window (and persists it).
// In EDIT mode there's no saved board to refresh, so it instead records the window
// on the canvas thread — the agent reads it from the next prompt and builds for it.
//
// Named ranges ("Last 7 days") roll: the label shows the name and refresh
// recomputes the window against now. "Custom" pins to its absolute from/to and
// the label shows the human-readable window.
export function DashboardDateRangeControl({
  dashboardId,
}: {
  dashboardId: string;
}) {
  const editing = useIsDashboardEditing(dashboardId);
  const threadId = threadIdFor(dashboardId);
  const thread = useCanvasThread(threadId);
  const setDateRange = useCanvasChatStore((s) => s.setDateRange);

  const { dashboard } = useDashboard(dashboardId);
  const { refresh, isRefreshing } = useRefreshDashboard(dashboardId);
  const [open, setOpen] = useState(false);
  // The just-picked window (view mode only), shown on the trigger immediately
  // while the refresh runs, then cleared when it settles (success OR failure) so
  // the control can never get stuck disabled on a failed refresh.
  const [pending, setPending] = useState<DashboardDateRange | null>(null);

  const savedRange = readStoredRange(dashboard?.spec);

  // Edit mode prefers the thread's selection (updated synchronously); otherwise
  // the saved window, with the in-flight pick winning so the trigger updates now.
  const stored = editing ? (thread.dateRange ?? savedRange) : savedRange;
  const display = pending ?? stored;
  // Roll a named range to now for both the picker's value and the label.
  const value = useMemo<DateTimeValue>(
    () => toPickerValue(liveWindow(display)),
    [display],
  );
  const label = formatRangeLabel(display);

  // Loading only while a refresh is actually in flight (view mode); edit mode
  // applies synchronously to the thread, so it never spins.
  const loading = !editing && (isRefreshing || pending !== null);

  const onApply = (next: DateTimeValue) => {
    setOpen(false);
    const range: DashboardDateRange = {
      name: next.range.name,
      from: next.start.getTime(),
      to: next.end.getTime(),
    };
    if (editing) {
      // Record it for the agent's next turn — building for a saved board isn't
      // possible mid-edit (the live spec lives on the thread, not the file). The
      // thread update drives the label, so no optimistic `pending` is needed.
      setDateRange(threadId, range);
    } else {
      setPending(range); // reflect the pick on the trigger immediately
      // refresh swallows its own errors, so clear pending whether it succeeds or
      // fails — otherwise a failed refresh would leave the control stuck disabled.
      void refresh({ dateRange: range, persistRange: true }).finally(() =>
        setPending(null),
      );
    }
  };

  const disabled = loading || thread.isStreaming;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm" disabled={disabled}>
            {loading ? (
              <SpinnerGapIcon size={14} className="motion-safe:animate-spin" />
            ) : (
              <CalendarBlankIcon size={14} />
            )}
            {label}
            <CaretDownIcon size={12} />
          </Button>
        }
      />
      <PopoverContent align="start" sideOffset={6} className="w-auto p-0">
        <DateTimePicker
          value={value}
          onApply={onApply}
          onCancel={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}
