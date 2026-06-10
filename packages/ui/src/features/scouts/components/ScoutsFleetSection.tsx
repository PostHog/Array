import { CaretDownIcon, CompassIcon } from "@phosphor-icons/react";
import type { ScoutConfig } from "@posthog/api-client/posthog-client";
import {
  computeFleetSummary,
  computeScoutRollups,
  sortConfigsForDisplay,
} from "@posthog/core/scouts/scoutPresentation";
import {
  SCOUT_RUNS_WINDOW_HOURS,
  scoutRunsWindowLabel,
} from "@posthog/core/scouts/scoutRunsWindow";
import { RelativeTimestamp } from "@posthog/ui/primitives/RelativeTimestamp";
import { Box, Flex, Text } from "@radix-ui/themes";
import { useMemo, useState } from "react";
import { useScoutConfigMutations } from "../hooks/useScoutConfigMutations";
import { useScoutConfigs } from "../hooks/useScoutConfigs";
import { useScoutRuns } from "../hooks/useScoutRuns";
import { ScoutRowCard } from "./ScoutRowCard";

/**
 * Expandable scout fleet manager for the agents config page. Collapsed it is
 * a one-line pulse; expanded it lists every scout with inline config controls.
 * Per-scout drill-down (run history, run detail) stays on its own routes.
 */
export function ScoutsFleetSection() {
  const { data: configs, isLoading } = useScoutConfigs();
  const [expanded, setExpanded] = useState(false);

  const lastRunAt = useMemo(() => {
    let latest: string | null = null;
    for (const config of configs ?? []) {
      if (config.last_run_at && (!latest || config.last_run_at > latest)) {
        latest = config.last_run_at;
      }
    }
    return latest;
  }, [configs]);

  if (isLoading) {
    return (
      <Box className="h-12 w-full animate-pulse rounded-(--radius-2) bg-(--gray-3)" />
    );
  }

  if (!configs || configs.length === 0) {
    return <ScoutsEmptyState />;
  }

  const enabledCount = configs.filter((config) => config.enabled).length;

  return (
    <Flex direction="column" gap="3">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-3 rounded-(--radius-2) border border-border bg-(--color-panel-solid) px-4 py-3.5 text-left transition-colors duration-150 hover:border-(--gray-6) hover:bg-(--gray-2)"
      >
        <Flex align="center" gap="3" className="min-w-0">
          <CompassIcon size={20} className="shrink-0 text-(--iris-9)" />
          <Flex direction="column" gap="0" className="min-w-0">
            <Text className="font-medium text-[13px] text-gray-12">
              Scout fleet
            </Text>
            <Text className="text-[12px] text-gray-11 leading-snug">
              {enabledCount} of {configs.length} scouts enabled
              {lastRunAt ? (
                <>
                  {" · last dispatched "}
                  <RelativeTimestamp timestamp={lastRunAt} />
                </>
              ) : null}
            </Text>
          </Flex>
        </Flex>
        <CaretDownIcon
          size={14}
          className={`shrink-0 text-gray-10 transition-transform duration-150 ${
            expanded ? "" : "-rotate-90"
          }`}
        />
      </button>
      {expanded ? <ScoutsFleetList configs={configs} /> : null}
    </Flex>
  );
}

function ScoutsFleetList({ configs }: { configs: ScoutConfig[] }) {
  const { data: runsWindow } = useScoutRuns();
  const { updateConfig } = useScoutConfigMutations();
  const [hideDisabled, setHideDisabled] = useState(false);

  const runs = runsWindow?.runs;
  const rollups = useMemo(() => computeScoutRollups(runs ?? []), [runs]);
  const summary = useMemo(
    () => computeFleetSummary(configs, rollups),
    [configs, rollups],
  );
  const visibleConfigs = useMemo(() => {
    const sorted = sortConfigsForDisplay(configs);
    return hideDisabled ? sorted.filter((config) => config.enabled) : sorted;
  }, [configs, hideDisabled]);

  return (
    <Flex direction="column" gap="3">
      <Flex align="center" gap="2" wrap="wrap">
        <Text className="text-[12.5px] text-gray-11">
          {summary.runningCount > 0
            ? `${summary.runningCount} running now`
            : "none running now"}
          {summary.successRate !== null
            ? ` · ${Math.round(summary.successRate * 100)}% success`
            : ""}
          {` · ${summary.emittedCount} signal${summary.emittedCount === 1 ? "" : "s"} emitted`}
          {summary.emitRate !== null
            ? ` (${Math.round(summary.emitRate * 100)}%)`
            : ""}
          <span className="text-gray-9">
            {" "}
            · {scoutRunsWindowLabel(runsWindow)}
          </span>
        </Text>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => setHideDisabled((value) => !value)}
          className="rounded px-1.5 py-0.5 text-[12px] text-gray-10 hover:bg-gray-3 hover:text-gray-12"
        >
          {hideDisabled ? "Show disabled" : "Hide disabled"}
        </button>
      </Flex>

      {/* Bounded to roughly 10 rows; larger fleets scroll within the section. */}
      <div className="max-h-[710px] overflow-y-auto">
        <Flex direction="column" gap="2">
          {visibleConfigs.map((config) => (
            <ScoutRowCard
              key={config.id}
              config={config}
              rollup={rollups.get(config.skill_name)}
              onUpdate={updateConfig}
            />
          ))}
        </Flex>
      </div>

      <Text className="text-[12px] text-gray-10">
        Run counts and emitted totals cover the last {SCOUT_RUNS_WINDOW_HOURS}{" "}
        hours of fleet runs. New scouts are created as{" "}
        <span className="font-mono text-[11px]">signals-scout-*</span> skills in
        your PostHog project.
      </Text>
    </Flex>
  );
}

function ScoutsEmptyState() {
  return (
    <Flex
      direction="column"
      gap="2"
      align="start"
      className="rounded-(--radius-3) border border-border bg-(--color-panel-solid) px-5 py-5"
    >
      <Flex align="center" gap="2">
        <CompassIcon size={18} className="text-(--iris-9)" />
        <Text className="font-medium text-[13px] text-gray-12">
          No scouts on this project yet
        </Text>
      </Flex>
      <Text className="max-w-2xl text-[12.5px] text-gray-11 leading-snug">
        Scouts are rolling out gradually. Once your project is enrolled, the
        canonical fleet appears here automatically and you can add custom scouts
        by creating{" "}
        <span className="font-mono text-[11px]">signals-scout-*</span> skills in
        PostHog.
      </Text>
    </Flex>
  );
}
