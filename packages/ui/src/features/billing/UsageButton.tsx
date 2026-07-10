import { Circle } from "@phosphor-icons/react";
import {
  formatResetTime,
  isUsageExceeded,
} from "@posthog/core/billing/usageDisplay";
import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@posthog/quill";
import { BILLING_FLAG } from "@posthog/shared";
import {
  ANALYTICS_EVENTS,
  type UpgradePromptClickedSurface,
} from "@posthog/shared/analytics-events";
import { track } from "../../shell/analytics";
import { useFeatureFlag } from "../feature-flags/useFeatureFlag";
import { openSettings } from "../settings/hooks/useOpenSettings";
import { useFreeUsage } from "./useFreeUsage";

// Title-bar usage entry point (replaces the old sidebar usage bar): a compact
// "Usage: N%" button whose hover card carries the full plan card — plan name,
// progress bar, reset time, and the Upgrade action. Built on quill's Popover
// with `openOnHover` on the trigger, so it behaves as a hover card (Base UI
// keeps it open while the pointer travels into the card to click Upgrade).
export function UsageButton() {
  const billingEnabled = useFeatureFlag(BILLING_FLAG);
  const { usage } = useFreeUsage(billingEnabled);

  if (!billingEnabled || !usage) return null;

  const exceeded = isUsageExceeded(usage);
  const dominant =
    usage.sustained.used_percent >= usage.burst.used_percent
      ? usage.sustained
      : usage.burst;
  const usagePercent = Math.min(Math.round(dominant.used_percent), 100);
  const resetLabel = formatResetTime(dominant.reset_at);

  const handleOpenPlan = (surface: UpgradePromptClickedSurface) => {
    track(ANALYTICS_EVENTS.UPGRADE_PROMPT_CLICKED, { surface });
    openSettings("plan-usage");
  };

  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={300}
        closeDelay={150}
        render={
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleOpenPlan("titlebar")}
          >
            {exceeded ? "Usage: limit reached" : `Usage: ${usagePercent}%`}
          </Button>
        }
      />
      <PopoverContent side="bottom" align="end" sideOffset={6}>
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
            onClick={() => handleOpenPlan("titlebar_card")}
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
      </PopoverContent>
    </Popover>
  );
}
