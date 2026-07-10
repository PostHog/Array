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
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { track } from "../../shell/analytics";
import { useFeatureFlag } from "../feature-flags/useFeatureFlag";
import {
  openSettings,
  prepareSettingsPage,
} from "../settings/hooks/useOpenSettings";
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
  const { usage, isLoading } = useFreeUsage(billingEnabled);
  // Controlled so the trigger click can close the card before navigating to
  // settings — uncontrolled, the same click would also toggle the popover open
  // over the settings view. Hover open/close still flows through onOpenChange.
  const [open, setOpen] = useState(false);

  if (!billingEnabled) return null;

  // Same-size placeholder while usage loads, so the button doesn't pop in and
  // shift the PostHog Web button after boot.
  if (!usage) {
    if (!isLoading) return null;
    return (
      <Button variant="outline" size="sm" disabled aria-hidden>
        <span className="animate-pulse">Usage: --%</span>
      </Button>
    );
  }

  const exceeded = isUsageExceeded(usage);
  const dominant =
    usage.sustained.used_percent >= usage.burst.used_percent
      ? usage.sustained
      : usage.burst;
  const usagePercent = Math.min(Math.round(dominant.used_percent), 100);
  const resetLabel = formatResetTime(dominant.reset_at);

  const handleOpenChange = (nextOpen: boolean) => {
    // The hover card has real impressions now (the old sidebar bar was
    // always-visible); count each open as a shown upgrade prompt.
    if (nextOpen && !open) {
      track(ANALYTICS_EVENTS.UPGRADE_PROMPT_SHOWN, {
        surface: "titlebar_card",
      });
    }
    setOpen(nextOpen);
  };

  const handleOpenPlan = (surface: UpgradePromptClickedSurface) => {
    track(ANALYTICS_EVENTS.UPGRADE_PROMPT_CLICKED, { surface });
    setOpen(false);
    openSettings("plan-usage");
  };

  // The trigger is a real <Link> (render={<Link/>} per convention), so the
  // router owns the navigation; this click handler carries the side effects
  // openSettings would have done — tracking, closing the card, and resetting
  // the settings-page store so no stale context/one-shot action leaks in.
  const handleTriggerClick = () => {
    track(ANALYTICS_EVENTS.UPGRADE_PROMPT_CLICKED, { surface: "titlebar" });
    setOpen(false);
    prepareSettingsPage();
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        openOnHover
        delay={300}
        closeDelay={150}
        render={
          <Button
            variant="outline"
            size="sm"
            render={
              <Link
                to="/settings/$category"
                params={{ category: "plan-usage" }}
                onClick={handleTriggerClick}
              />
            }
          >
            {exceeded ? "Usage: limit reached" : `Usage: ${usagePercent}%`}
          </Button>
        }
      />
      {/* no-drag: the popover opens under the title bar's drag region; without
          the opt-out a click near its top edge is swallowed as a window drag. */}
      <PopoverContent
        side="bottom"
        align="end"
        sideOffset={6}
        className="no-drag gap-2"
      >
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
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0"
            onClick={() => handleOpenPlan("titlebar_card")}
          >
            Upgrade
          </Button>
        </div>
        <Progress
          value={usagePercent}
          variant={exceeded ? "destructive" : "default"}
        />
        <div className="font-normal text-[11px] text-muted-foreground">
          {resetLabel}
        </div>
      </PopoverContent>
    </Popover>
  );
}
