import { ArrowLeftIcon, CompassIcon } from "@phosphor-icons/react";
import type { ScoutRun } from "@posthog/api-client/posthog-client";
import {
  computeScoutRollups,
  deriveRunFailureKind,
  formatRunDuration,
  normalizeRunStatus,
  prettifyScoutSkillName,
  runDurationSeconds,
  runMatchesFilter,
  type ScoutRunFilter,
  scoutSkillNameFromSlug,
  scoutSkillSlug,
} from "@posthog/core/scouts/scoutPresentation";
import { useSetHeaderContent } from "@posthog/ui/hooks/useSetHeaderContent";
import { RelativeTimestamp } from "@posthog/ui/primitives/RelativeTimestamp";
import { Badge, Box, Flex, Text } from "@radix-ui/themes";
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

const FILTERS: { value: ScoutRunFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "emitted", label: "Emitted" },
  { value: "quiet", label: "Quiet" },
  { value: "failed", label: "Failed" },
];

export function ScoutDetailView({ skillSlug }: { skillSlug: string }) {
  const skillName = scoutSkillNameFromSlug(skillSlug);
  const displayName = prettifyScoutSkillName(skillName);

  const headerContent = useMemo(
    () => (
      <Flex align="center" gap="2" className="w-full min-w-0">
        <CompassIcon size={12} className="shrink-0 text-gray-10" />
        <Text
          className="truncate whitespace-nowrap font-medium text-[13px]"
          title={displayName}
        >
          {displayName}
        </Text>
      </Flex>
    ),
    [displayName],
  );
  useSetHeaderContent(headerContent);

  const { data: configs } = useScoutConfigs();
  const { data: runs, isLoading: runsLoading } = useScoutRuns();
  const { updateConfig } = useScoutConfigMutations();
  const [filter, setFilter] = useState<ScoutRunFilter>("all");

  const config = configs?.find((entry) => entry.skill_name === skillName);
  // The runs endpoint has no skill_name filter yet (scouts-ui api gap 1), so
  // select this scout's runs from the recent fleet window client-side.
  const scoutRuns = useMemo(
    () => (runs ?? []).filter((run) => run.skill_name === skillName),
    [runs, skillName],
  );
  const rollup = useMemo(
    () => computeScoutRollups(scoutRuns).get(skillName),
    [scoutRuns, skillName],
  );
  const filteredRuns = useMemo(
    () => scoutRuns.filter((run) => runMatchesFilter(run, filter)),
    [scoutRuns, filter],
  );
  const filterCounts = useMemo(() => {
    const counts = new Map<ScoutRunFilter, number>();
    for (const entry of FILTERS) {
      counts.set(
        entry.value,
        scoutRuns.filter((run) => runMatchesFilter(run, entry.value)).length,
      );
    }
    return counts;
  }, [scoutRuns]);

  const latestVersion = scoutRuns[0]?.skill_version;
  const state = config
    ? deriveScoutRowState(config, rollup, new Date())
    : "disabled";

  return (
    <Flex direction="column" className="h-full min-h-0">
      <Flex
        direction="column"
        gap="0.5"
        className="cursor-default select-none border-(--gray-5) border-b px-6 pt-5 pb-5"
      >
        <Link
          to="/code/agents/scouts"
          className="mb-1 flex w-fit items-center gap-1 text-[12px] text-gray-10 no-underline hover:text-gray-12"
        >
          <ArrowLeftIcon size={12} />
          Scouts
        </Link>
        <Flex align="center" gap="3" wrap="wrap">
          <ScoutStatusDot state={state} />
          <Text className="font-bold text-[22px] text-gray-12 leading-tight tracking-tight">
            {displayName}
          </Text>
          <ScoutOriginBadge skillName={skillName} />
          {config ? <DryRunBadge config={config} /> : null}
          {latestVersion !== undefined ? (
            <Text className="text-[12px] text-gray-10">v{latestVersion}</Text>
          ) : null}
        </Flex>
        <Text className="font-mono text-[11px] text-gray-10">{skillName}</Text>
      </Flex>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto max-w-4xl px-6 py-6">
          <Flex direction="column" gap="5">
            {config ? (
              <Flex
                align="center"
                justify="between"
                gap="4"
                wrap="wrap"
                className="rounded-(--radius-3) border border-border bg-(--color-panel-solid) px-4 py-3"
              >
                <Flex direction="column" gap="1" className="min-w-0">
                  <Text className="font-medium text-[13px] text-gray-12">
                    Configuration
                  </Text>
                  <Text className="text-[11.5px] text-gray-10">
                    {config.last_run_at ? (
                      <>
                        Last dispatched{" "}
                        <RelativeTimestamp timestamp={config.last_run_at} />
                      </>
                    ) : (
                      "Never dispatched"
                    )}
                  </Text>
                </Flex>
                <ScoutConfigControls config={config} onUpdate={updateConfig} />
              </Flex>
            ) : (
              <Text className="text-[12.5px] text-gray-11">
                No config found for this scout on the current project.
              </Text>
            )}

            {rollup && rollup.runCount > 0 ? (
              <Text className="text-[12.5px] text-gray-11">
                Recent window: {rollup.runCount} runs · {rollup.completedCount}{" "}
                completed · {rollup.failedCount} failed · {rollup.emittedCount}{" "}
                signal
                {rollup.emittedCount === 1 ? "" : "s"} emitted
              </Text>
            ) : null}

            <Flex direction="column" gap="3">
              <Flex align="center" gap="2" wrap="wrap">
                <Text className="font-semibold text-[13px] text-gray-12">
                  Runs
                </Text>
                <span className="flex-1" />
                {FILTERS.map((entry) => (
                  <button
                    key={entry.value}
                    type="button"
                    onClick={() => setFilter(entry.value)}
                    className={`rounded-full px-2.5 py-0.5 text-[11.5px] transition-colors ${
                      filter === entry.value
                        ? "bg-(--accent-4) text-accent-12"
                        : "text-gray-10 hover:bg-gray-3 hover:text-gray-12"
                    }`}
                  >
                    {entry.label} {filterCounts.get(entry.value) ?? 0}
                  </button>
                ))}
              </Flex>

              {runsLoading ? (
                <RunListSkeleton />
              ) : filteredRuns.length === 0 ? (
                <Text className="text-[12.5px] text-gray-11">
                  {scoutRuns.length === 0
                    ? "No runs in the recent window the API returns."
                    : "No runs match this filter in the recent window."}
                </Text>
              ) : (
                <Flex direction="column" gap="2">
                  {filteredRuns.map((run) => (
                    <ScoutRunListItem
                      key={run.run_id}
                      run={run}
                      skillSlug={scoutSkillSlug(skillName)}
                    />
                  ))}
                </Flex>
              )}

              <Text className="text-[12px] text-gray-10">
                Showing this scout&apos;s runs from the most recent fleet runs
                the API returns (currently capped at 100 fleet-wide).
              </Text>
            </Flex>
          </Flex>
        </div>
      </div>
    </Flex>
  );
}

function ScoutRunListItem({
  run,
  skillSlug,
}: {
  run: ScoutRun;
  skillSlug: string;
}) {
  const now = new Date();
  const status = normalizeRunStatus(run.status);
  const failureKind = deriveRunFailureKind(run, now);
  const duration = formatRunDuration(runDurationSeconds(run, now));
  const emitted = run.emitted_count ?? 0;

  return (
    <Link
      to="/code/agents/scouts/$skillName/runs/$runId"
      params={{ skillName: skillSlug, runId: run.run_id }}
      className="block rounded-(--radius-3) border border-border bg-(--color-panel-solid) px-4 py-3 no-underline transition duration-150 hover:border-(--gray-6) hover:bg-(--gray-2)"
    >
      <Flex direction="column" gap="1.5">
        <Flex align="center" gap="2" wrap="wrap">
          <RunGlyph status={status} emitted={emitted} />
          <RelativeTimestamp timestamp={run.started_at} />
          {duration ? (
            <Text className="text-[11.5px] text-gray-10">· {duration}</Text>
          ) : null}
          {failureKind ? (
            <Text className="text-(--amber-11) text-[11.5px]">
              · {failureKind === "timed_out" ? "timed out" : "failed"}
            </Text>
          ) : null}
          <span className="flex-1" />
          {emitted > 0 ? (
            <Badge variant="soft" color="iris" size="1" className="text-[11px]">
              {emitted} signal{emitted === 1 ? "" : "s"}
            </Badge>
          ) : status === "completed" ? (
            <Text className="text-[11.5px] text-gray-9">quiet</Text>
          ) : null}
        </Flex>
        {run.summary ? (
          <Text className="line-clamp-2 text-[12.5px] text-gray-11 leading-snug">
            {run.summary}
          </Text>
        ) : status === "failed" ? (
          <Text className="text-[12.5px] text-gray-10 italic leading-snug">
            No summary – the run ended before writing its close-out. Open the
            run for the task log.
          </Text>
        ) : null}
      </Flex>
    </Link>
  );
}

function RunGlyph({ status, emitted }: { status: string; emitted: number }) {
  if (status === "failed") {
    return <Text className="font-medium text-(--red-9) text-[12px]">✗</Text>;
  }
  if (status === "running" || status === "queued") {
    return (
      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-(--blue-9)" />
    );
  }
  if (emitted > 0) {
    return <Text className="font-medium text-(--iris-9) text-[12px]">◆</Text>;
  }
  return <Text className="text-[12px] text-gray-8">·</Text>;
}

function RunListSkeleton() {
  return (
    <Flex direction="column" gap="2">
      {[0, 1, 2].map((index) => (
        <Box
          key={index}
          className="h-14 w-full animate-pulse rounded-(--radius-3) bg-(--gray-3)"
        />
      ))}
    </Flex>
  );
}
