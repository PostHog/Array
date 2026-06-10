import type { ScoutConfig } from "@posthog/api-client/posthog-client";
import { getScoutOrigin } from "@posthog/core/scouts/scoutPresentation";
import { Badge } from "@radix-ui/themes";

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
