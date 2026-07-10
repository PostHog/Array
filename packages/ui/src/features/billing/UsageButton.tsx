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
  Progress,
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
// The card body styles with quill tokens (foreground/muted-foreground/primary,
// quill Progress) — radix scale classes don't resolve inside the data-quill
// popover portal.
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
          <span className="font-medium text-foreground text-xs">
            Free plan
            <Circle
              size={4}
              weight="fill"
              className="mx-1.5 inline text-muted-foreground"
            />
            <span className="font-normal text-muted-foreground">
              {exceeded ? "Limit reached" : `${usagePercent}% used`}
            </span>
          </span>
          <button
            type="button"
            className="bg-transparent font-medium text-primary text-xs transition-opacity hover:opacity-80"
            onClick={() => handleOpenPlan("titlebar_card")}
          >
            Upgrade
          </button>
        </div>
        <Progress
          className="mt-2"
          value={usagePercent}
          variant={exceeded ? "destructive" : "default"}
        />
        <div className="mt-1.5 font-normal text-[11px] text-muted-foreground">
          {resetLabel}
        </div>
      </PopoverContent>
    </Popover>
  );
}
