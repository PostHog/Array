import { ArrowLeftIcon, CompassIcon } from "@phosphor-icons/react";
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
import { useSetHeaderContent } from "@posthog/ui/hooks/useSetHeaderContent";
import { RelativeTimestamp } from "@posthog/ui/primitives/RelativeTimestamp";
import { Box, Flex, Text } from "@radix-ui/themes";
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
import { ScoutConfigControls } from "./ScoutConfigControls";

export function ScoutsView() {
  const headerContent = useMemo(
    () => (
      <Flex align="center" gap="2" className="w-full min-w-0">
        <CompassIcon size={12} className="shrink-0 text-gray-10" />
        <Text
          className="truncate whitespace-nowrap font-medium text-[13px]"
          title="Scouts"
        >
          Scouts
        </Text>
      </Flex>
    ),
    [],
  );
  useSetHeaderContent(headerContent);

  const { data: configs, isLoading: configsLoading } = useScoutConfigs();
  const { data: runs } = useScoutRuns();
  const { updateConfig } = useScoutConfigMutations();
  const [hideDisabled, setHideDisabled] = useState(false);

  const rollups = useMemo(() => computeScoutRollups(runs ?? []), [runs]);
  const summary = useMemo(
    () => computeFleetSummary(configs ?? [], rollups),
    [configs, rollups],
  );
  const visibleConfigs = useMemo(() => {
    const sorted = sortConfigsForDisplay(configs ?? []);
    return hideDisabled ? sorted.filter((config) => config.enabled) : sorted;
  }, [configs, hideDisabled]);

  return (
    <Flex direction="column" className="h-full min-h-0">
      <Flex
        direction="column"
        gap="0.5"
        className="cursor-default select-none border-(--gray-5) border-b px-6 pt-5 pb-5"
      >
        <Link
          to="/code/agents"
          className="mb-1 flex w-fit items-center gap-1 text-[12px] text-gray-10 no-underline hover:text-gray-12"
        >
          <ArrowLeftIcon size={12} />
          Agents
        </Link>
        <Text className="font-bold text-[22px] text-gray-12 leading-tight tracking-tight">
          Scouts
        </Text>
        <Text className="max-w-3xl text-[12.5px] text-gray-11 leading-snug">
          Scheduled agents that sweep this project on a cadence and emit
          findings to your inbox. A quiet run is the healthy outcome – it means
          the scout looked and found nothing worth your attention.
        </Text>
      </Flex>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto max-w-4xl px-6 py-6">
          {configsLoading ? (
            <ScoutsListSkeleton />
          ) : !configs || configs.length === 0 ? (
            <ScoutsEmptyState />
          ) : (
            <Flex direction="column" gap="4">
              <Flex align="center" gap="2" wrap="wrap">
                <Text className="text-[12.5px] text-gray-11">
                  {summary.enabledCount} of {summary.totalCount} enabled
                  {summary.runningCount > 0
                    ? ` · ${summary.runningCount} running now`
                    : ""}
                  {summary.successRate !== null
                    ? ` · ${Math.round(summary.successRate * 100)}% success`
                    : ""}
                  {` · ${summary.emittedCount} signal${summary.emittedCount === 1 ? "" : "s"} emitted`}
                  <span className="text-gray-9"> (recent runs)</span>
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

              <Text className="text-[12px] text-gray-10">
                Run counts and emitted totals cover the most recent fleet runs
                the API returns, not all time. New scouts are created as{" "}
                <span className="font-mono text-[11px]">signals-scout-*</span>{" "}
                skills in your PostHog project.
              </Text>
            </Flex>
          )}
        </div>
      </div>
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

  return (
    <Flex
      align="center"
      gap="4"
      className={`rounded-(--radius-3) border border-border bg-(--color-panel-solid) px-4 py-3 transition duration-150 hover:border-(--gray-6) hover:bg-(--gray-2) ${
        config.enabled ? "" : "opacity-65"
      }`}
    >
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
      <ScoutConfigControls config={config} onUpdate={onUpdate} />
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
      rollup.emittedCount > 0
        ? `${rollup.emittedCount} signal${rollup.emittedCount === 1 ? "" : "s"}`
        : "0 signals (quiet)",
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

function ScoutsListSkeleton() {
  return (
    <Flex direction="column" gap="2">
      {[0, 1, 2, 3].map((index) => (
        <Box
          key={index}
          className="h-16 w-full animate-pulse rounded-(--radius-3) bg-(--gray-3)"
        />
      ))}
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
