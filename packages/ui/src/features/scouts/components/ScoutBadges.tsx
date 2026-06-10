import type { ScoutConfig } from "@posthog/api-client/posthog-client";
import {
  getScoutOrigin,
  isRunStuck,
  normalizeRunStatus,
  type ScoutRollup,
} from "@posthog/core/scouts/scoutPresentation";
import { Badge } from "@radix-ui/themes";

export type ScoutRowState = "ok" | "running" | "failing" | "stuck" | "disabled";

export function deriveScoutRowState(
  config: ScoutConfig,
  rollup: ScoutRollup | undefined,
  now: Date,
): ScoutRowState {
  if (!config.enabled) return "disabled";
  if (rollup?.runningRun) {
    return isRunStuck(rollup.runningRun, now) ? "stuck" : "running";
  }
  if (
    rollup?.latestRun &&
    normalizeRunStatus(rollup.latestRun.status) === "failed"
  ) {
    return "failing";
  }
  return "ok";
}

const ROW_STATE_DOT_CLASS: Record<ScoutRowState, string> = {
  ok: "bg-(--green-9)",
  running: "bg-(--blue-9) animate-pulse",
  failing: "bg-(--amber-9)",
  stuck: "bg-(--red-9)",
  disabled: "bg-(--gray-7)",
};

export function ScoutStatusDot({ state }: { state: ScoutRowState }) {
  return (
    <span
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${ROW_STATE_DOT_CLASS[state]}`}
      aria-hidden
    />
  );
}

export function ScoutOriginBadge({ skillName }: { skillName: string }) {
  const origin = getScoutOrigin(skillName);
  return (
    <Badge
      variant="soft"
      color={origin === "canonical" ? "gray" : "iris"}
      size="1"
      className="text-[11px]"
    >
      {origin === "canonical" ? "Canonical" : "Custom"}
    </Badge>
  );
}

export function DryRunBadge({ config }: { config: ScoutConfig }) {
  if (config.emit) return null;
  return (
    <Badge variant="soft" color="amber" size="1" className="text-[11px]">
      Dry run
    </Badge>
  );
}

const SEVERITY_COLORS: Record<string, "red" | "orange" | "amber" | "gray"> = {
  P0: "red",
  P1: "red",
  P2: "orange",
  P3: "amber",
  P4: "gray",
};

export function SeverityBadge({ severity }: { severity: string | null }) {
  if (!severity) return null;
  return (
    <Badge
      variant="soft"
      color={SEVERITY_COLORS[severity] ?? "gray"}
      size="1"
      className="text-[11px]"
    >
      {severity}
    </Badge>
  );
}
