import { CaretDownIcon, CompassIcon, GearSixIcon } from "@phosphor-icons/react";
import type { ScoutConfig, ScoutRun } from "@posthog/api-client/posthog-client";
import {
  computeFleetSummary,
  computeScoutRollups,
  formatRunIntervalShort,
  prettifyScoutSkillName,
  type ScoutRollup,
  scoutSkillSlug,
  sortConfigsForDisplay,
} from "@posthog/core/scouts/scoutPresentation";
import {
  SCOUT_RUNS_WINDOW_HOURS,
  scoutRunsWindowLabel,
} from "@posthog/core/scouts/scoutRunsWindow";
import { RelativeTimestamp } from "@posthog/ui/primitives/RelativeTimestamp";
import { Box, Flex, Text, Tooltip } from "@radix-ui/themes";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useScoutConfigMutations } from "../hooks/useScoutConfigMutations";
import { useScoutConfigs } from "../hooks/useScoutConfigs";
import { useScoutRuns } from "../hooks/useScoutRuns";
import {
  DryRunBadge,
  deriveScoutRowState,
  ScoutOriginBadge,
  ScoutStatusDot,
} from "./ScoutBadges";
import { ScoutConfigForm, ScoutEnabledSwitch } from "./ScoutConfigControls";
import { ScoutRunBoxes } from "./ScoutRunBoxes";

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
          <span className="text-gray-9">
            {" "}
            ({scoutRunsWindowLabel(runsWindow)})
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
            <ScoutRow
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

function ScoutRow({
  config,
  rollup,
  onUpdate,
}: {
  config: ScoutConfig;
  rollup: ScoutRollup | undefined;
  onUpdate: (
    configId: string,
    updates: Parameters<
      ReturnType<typeof useScoutConfigMutations>["updateConfig"]
    >[1],
  ) => void;
}) {
  const now = new Date();
  const state = deriveScoutRowState(config, rollup, now);
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <Flex
      direction="column"
      className={`rounded-(--radius-3) border border-border bg-(--color-panel-solid) px-4 py-3 transition duration-150 hover:border-(--gray-6) hover:bg-(--gray-2) ${
        config.enabled ? "" : "opacity-65"
      }`}
    >
      <Flex align="center" gap="4">
        <Link
          to="/code/agents/scouts/$skillName"
          params={{ skillName: scoutSkillSlug(config.skill_name) }}
          className="flex min-w-0 flex-1 items-center gap-3 no-underline"
        >
          <ScoutStatusDot state={state} />
          <Flex direction="column" gap="1" className="min-w-0">
            <Flex align="center" gap="2" wrap="wrap">
              <Text className="font-medium text-[13px] text-gray-12">
                {prettifyScoutSkillName(config.skill_name)}
              </Text>
              <ScoutOriginBadge skillName={config.skill_name} />
              <DryRunBadge config={config} />
              <Text className="text-[11px] text-gray-10">
                {formatRunIntervalShort(config.run_interval_minutes)}
              </Text>
            </Flex>
            <ScoutRowStats
              config={config}
              rollup={rollup}
              state={state}
              runningRun={rollup?.runningRun ?? null}
            />
          </Flex>
        </Link>
        <ScoutRunBoxes runs={rollup?.runs ?? []} />
        <Flex align="center" gap="3" className="shrink-0">
          <ScoutEnabledSwitch config={config} onUpdate={onUpdate} />
          <Tooltip content="Scout settings">
            <button
              type="button"
              onClick={() => setSettingsOpen((value) => !value)}
              aria-expanded={settingsOpen}
              aria-label={`${config.skill_name} settings`}
              className={`flex h-6 w-6 items-center justify-center rounded transition-colors ${
                settingsOpen
                  ? "bg-(--gray-4) text-gray-12"
                  : "text-gray-10 hover:bg-(--gray-3) hover:text-gray-12"
              }`}
            >
              <GearSixIcon size={14} />
            </button>
          </Tooltip>
        </Flex>
      </Flex>
      {settingsOpen ? (
        <Box className="mt-3 border-(--gray-4) border-t pt-3">
          <ScoutConfigForm config={config} onUpdate={onUpdate} />
        </Box>
      ) : null}
    </Flex>
  );
}

function ScoutRowStats({
  config,
  rollup,
  state,
  runningRun,
}: {
  config: ScoutConfig;
  rollup: ScoutRollup | undefined;
  state: string;
  runningRun: ScoutRun | null;
}) {
  const parts: string[] = [];
  if (rollup && rollup.runCount > 0) {
    parts.push(`${rollup.runCount} runs`);
    parts.push(`${rollup.completedCount} ok / ${rollup.failedCount} failed`);
    parts.push(
      `${rollup.emittedCount} signal${rollup.emittedCount === 1 ? "" : "s"} emitted`,
    );
  }

  return (
    <Flex align="center" gap="2" className="text-[11.5px] text-gray-10">
      {state === "running" && runningRun ? (
        <Text className="text-(--blue-11) text-[11.5px]">running now</Text>
      ) : state === "stuck" ? (
        <Text className="text-(--red-11) text-[11.5px]">
          running past the deadline – may be stuck
        </Text>
      ) : config.last_run_at ? (
        <Flex align="center" gap="1">
          <Text className="text-[11.5px] text-gray-10">last ran</Text>
          <RelativeTimestamp timestamp={config.last_run_at} />
        </Flex>
      ) : (
        <Text className="text-[11.5px] text-gray-10">never run</Text>
      )}
      {parts.length > 0 && (
        <Text className="text-[11.5px] text-gray-10">
          · {parts.join(" · ")}
        </Text>
      )}
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
