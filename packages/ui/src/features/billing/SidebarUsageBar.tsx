import { Circle } from "@phosphor-icons/react";
import {
  formatResetTime,
  isUsageExceeded,
} from "@posthog/core/billing/usageDisplay";
import { BILLING_FLAG } from "@posthog/shared";
import { ANALYTICS_EVENTS } from "@posthog/shared/analytics-events";
import { track } from "../../shell/analytics";
import { useFeatureFlag } from "../feature-flags/useFeatureFlag";
import { openSettings } from "../settings/hooks/useOpenSettings";
import { useFreeUsage } from "./useFreeUsage";

export function SidebarUsageBar() {
  const billingEnabled = useFeatureFlag(BILLING_FLAG);
  const { usage, isLoading } = useFreeUsage(billingEnabled);

  if (!billingEnabled) return null;

  const handleUpgrade = () => {
    track(ANALYTICS_EVENTS.UPGRADE_PROMPT_CLICKED, { surface: "sidebar" });
    openSettings("plan-usage");
  };

  if (!usage) {
    if (!isLoading) return null;
    return (
      <div className="shrink-0 border-gray-6 border-t px-3 py-3">
        <div className="flex items-center justify-between">
          <span className="font-medium text-gray-11 text-xs">Free plan</span>
        </div>
        <div className="mt-2 h-2.5 w-full animate-pulse overflow-hidden rounded-full bg-gray-4" />
      </div>
    );
  }

  const exceeded = isUsageExceeded(usage);
  const dominant =
    usage.sustained.used_percent >= usage.burst.used_percent
      ? usage.sustained
      : usage.burst;
  const usagePercent = Math.min(Math.round(dominant.used_percent), 100);
  const resetLabel = formatResetTime(dominant.reset_at);

  return (
    <div className="shrink-0 border-gray-6 border-t px-3 py-3">
      <div className="flex items-center justify-between">
        <span className="font-medium text-gray-11 text-xs">
          Free plan
          <Circle
            size={4}
            weight="fill"
            className="mx-1.5 inline text-gray-8"
          />
          <span className="font-normal text-gray-10">
            {exceeded ? "Limit reached" : `${usagePercent}% used`}
          </span>
        </span>
        <button
          type="button"
          className="bg-transparent font-medium text-accent-11 text-xs transition-colors hover:text-accent-12"
          onClick={handleUpgrade}
        >
          Upgrade
        </button>
      </div>
      <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-gray-4">
        <div
          className={`h-full rounded-full transition-all ${exceeded ? "bg-red-9" : "bg-accent-9"}`}
          style={{ width: `${usagePercent}%` }}
        />
      </div>
      <div className="mt-1.5 font-normal text-[11px] text-gray-9">
        {resetLabel}
      </div>
    </div>
  );
}
