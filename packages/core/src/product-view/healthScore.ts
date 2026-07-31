import type { EmbeddedBrowserOverlayItem } from "@posthog/platform/embedded-browser";
import type { ElementUsageStats } from "./elementMatching";

/**
 * Element health from real interaction quality: rage clicks and dead clicks
 * as a share of all clicks. Small samples never alarm — one angry click on a
 * ten-click button is noise.
 */

const MIN_CLICKS_FOR_ALARM = 50;
const AMBER_FRUSTRATION = 0.01;
const RED_FRUSTRATION = 0.05;

export type ElementHealth = "green" | "amber" | "red";

export function healthFor(stats: ElementUsageStats): ElementHealth {
  const total = stats.clicks + stats.rageclicks + stats.deadclicks;
  if (total < MIN_CLICKS_FOR_ALARM) return "green";
  const frustration = (stats.rageclicks + stats.deadclicks) / total;
  if (frustration >= RED_FRUSTRATION) return "red";
  if (frustration >= AMBER_FRUSTRATION) return "amber";
  return "green";
}

const compact = (value: number): string =>
  Intl.NumberFormat("en", { notation: "compact" }).format(value);

function labelFor(stats: ElementUsageStats): string {
  const total = stats.clicks + stats.rageclicks + stats.deadclicks;
  const frustration =
    total > 0 ? (stats.rageclicks + stats.deadclicks) / total : 0;
  const base = `${compact(stats.clicks)} clicks`;
  if (frustration >= AMBER_FRUSTRATION && total >= MIN_CLICKS_FOR_ALARM) {
    return `${base} · ${Math.round(frustration * 100)}% frustrated`;
  }
  return base;
}

/**
 * The ambient overlay's clutter budget: every unhealthy element is always
 * shown; remaining slots go to the highest-usage healthy elements.
 */
export function buildOverlayItems(
  stats: Map<string, ElementUsageStats>,
  opts: { maxItems: number },
): EmbeddedBrowserOverlayItem[] {
  const entries = [...stats.entries()].map(([selectorHash, s]) => ({
    selectorHash,
    stats: s,
    halo: healthFor(s),
    label: labelFor(s),
  }));
  const unhealthy = entries.filter((e) => e.halo !== "green");
  const healthy = entries
    .filter((e) => e.halo === "green")
    .sort((a, b) => b.stats.clicks - a.stats.clicks);
  const budgetForHealthy = Math.max(0, opts.maxItems - unhealthy.length);
  return [...unhealthy, ...healthy.slice(0, budgetForHealthy)].map(
    ({ selectorHash, halo, label }) => ({ selectorHash, halo, label }),
  );
}
