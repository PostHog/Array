import { useUsageLimitStore } from "@features/billing/stores/usageLimitStore";
import { formatResetTime } from "@features/billing/utils";
import { useSessionStore } from "@features/sessions/stores/sessionStore";
import { useSettingsDialogStore } from "@features/settings/stores/settingsDialogStore";
import { trpcClient } from "@renderer/trpc/client";
import { logger } from "@utils/logger";
import { toast } from "@utils/toast";

const log = logger.scope("usage-threshold-toast");

const openPlanUsage = () => {
  useSettingsDialogStore.getState().open("plan-usage");
};

function hasActiveSession(): boolean {
  const sessions = useSessionStore.getState().sessions;
  return Object.values(sessions).some(
    (s) => s.status === "connected" && s.isPromptPending,
  );
}

export function initializeUsageThresholdToast() {
  const subscription = trpcClient.usageMonitor.onThresholdCrossed.subscribe(
    undefined,
    {
      onData: (event) => {
        const resetLabel = formatResetTime(
          event.resetAt ?? undefined,
          event.resetsInSeconds,
        );

        if (event.threshold === 100) {
          if (hasActiveSession()) {
            useUsageLimitStore.getState().show();
            return;
          }
          toast.error("Usage limit reached", {
            id: `usage-threshold-${event.bucket}-100`,
            description: resetLabel,
          });
          return;
        }

        const limitName =
          event.bucket === "burst" ? "daily limit" : "monthly limit";
        toast.warning(
          `You've used ${Math.round(event.usedPercent)}% of your ${limitName}`,
          {
            id: `usage-threshold-${event.bucket}-${event.threshold}`,
            description: resetLabel,
            action: { label: "View usage", onClick: openPlanUsage },
            duration: 10_000,
          },
        );
      },
      onError: (error) => {
        log.error("Usage threshold subscription error", { error });
      },
    },
  );

  return () => {
    subscription.unsubscribe();
  };
}
