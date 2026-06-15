import type {
  LinkedSignalReport,
  ScoutRun,
} from "@posthog/api-client/posthog-client";
import { ANALYTICS_EVENTS } from "@posthog/shared";
import { track } from "@posthog/ui/shell/analytics";
import { getPostHogUrl } from "@posthog/ui/utils/urls";
import { Box, Flex, Text } from "@radix-ui/themes";
import { useMemo, useState } from "react";
import { useScoutEmissionReports } from "../hooks/useScoutEmissionReports";
import { useScoutRunEmissions } from "../hooks/useScoutRunEmissions";
import { ScoutEmissionCard } from "./ScoutEmissionCard";
import { ScoutFindingDiscussButton } from "./ScoutFindingDiscussButton";
import { ScoutFindingShareButton } from "./ScoutFindingShareButton";
import { ScoutTaskRunLink } from "./ScoutTaskRunLink";

/**
 * Cadence bounds a scout to ~48 runs per window (30-minute minimum interval),
 * but a backend-configured cadence below the UI presets could push past that;
 * capping the initially mounted runs caps the emissions-query fan-out too.
 */
const INITIAL_EMITTED_RUNS = 10;

/**
 * The signals this scout emitted in the runs window, newest first. Emissions
 * are only fetchable per run, so each emitted run gets its own child query –
 * runs beyond the cap stay unmounted (and unfetched) until "Show more".
 */
export function ScoutSignalsSection({
  runs,
  windowLabel,
  loading,
  error,
  highlightFindingId,
}: {
  runs: ScoutRun[];
  windowLabel: string;
  loading: boolean;
  error?: boolean;
  /** Emission id from a shared finding link – expanded and scrolled to when present. */
  highlightFindingId?: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const emittedRuns = runs.filter((run) => (run.emitted_count ?? 0) > 0);
  const visibleRuns = showAll
    ? emittedRuns
    : emittedRuns.slice(0, INITIAL_EMITTED_RUNS);
  const hiddenCount = emittedRuns.length - visibleRuns.length;

  return (
    <Flex direction="column" gap="3">
      <Text className="font-semibold text-[13px] text-gray-12">Signals</Text>
      {loading ? (
        <Box className="h-24 w-full animate-pulse rounded-(--radius-2) bg-(--gray-3)" />
      ) : error ? (
        <Text className="text-(--red-11) text-[12.5px]">
          Couldn&apos;t load this scout&apos;s runs, so signals for the{" "}
          {windowLabel} are unavailable.
        </Text>
      ) : emittedRuns.length === 0 ? (
        <Text className="text-[12.5px] text-gray-11">
          No signals emitted in the {windowLabel}.
        </Text>
      ) : (
        <Flex direction="column" gap="2">
          {visibleRuns.map((run) => (
            <RunEmissions
              key={run.run_id}
              run={run}
              highlightFindingId={highlightFindingId}
            />
          ))}
          {hiddenCount > 0 ? (
            <button
              type="button"
              onClick={() => {
                setShowAll(true);
                track(ANALYTICS_EVENTS.SCOUT_ACTION, {
                  action_type: "show_more_emitted_runs",
                  surface: "scout_detail",
                  skill_name: runs[0]?.skill_name,
                  emitted_count: emittedRuns.length,
                });
              }}
              className="w-fit rounded-full px-2.5 py-0.5 text-[11.5px] text-gray-10 transition-colors hover:bg-gray-3 hover:text-gray-12"
            >
              Show {hiddenCount} more emitted run{hiddenCount === 1 ? "" : "s"}
            </button>
          ) : null}
        </Flex>
      )}
    </Flex>
  );
}

function RunEmissions({
  run,
  highlightFindingId,
}: {
  run: ScoutRun;
  highlightFindingId?: string;
}) {
  const {
    data: emissions,
    isLoading,
    isError,
  } = useScoutRunEmissions(run.run_id);
  // Best-effort reverse lookup of which inbox report each finding grouped into.
  // A failure here is non-fatal: the cards still render, just without the chip.
  const { data: emissionReports } = useScoutEmissionReports(run.run_id);
  const reportBySourceId = useMemo(() => {
    const map = new Map<string, LinkedSignalReport>();
    for (const link of emissionReports ?? []) {
      if (link.report) map.set(link.source_id, link.report);
    }
    return map;
  }, [emissionReports]);
  const taskRunUrl = run.task_url ? getPostHogUrl(run.task_url) : null;

  if (isLoading) {
    return (
      <Box className="h-24 w-full animate-pulse rounded-(--radius-2) bg-(--gray-3)" />
    );
  }

  // The run-level emitted_count promised signals; an errored or empty
  // emissions response must say so rather than render nothing.
  if (isError || !emissions || emissions.length === 0) {
    return (
      <Flex
        align="center"
        gap="2"
        className="rounded-(--radius-2) border border-border bg-(--color-panel-solid) px-4 py-3"
      >
        <Text className="flex-1 text-[12.5px] text-gray-10">
          {isError
            ? "Couldn't load this run's signals."
            : "No signal details available for this run."}
        </Text>
        {taskRunUrl ? (
          <ScoutTaskRunLink run={run} taskRunUrl={taskRunUrl} />
        ) : null}
      </Flex>
    );
  }

  return (
    <Flex direction="column" gap="2">
      {emissions.map((emission) => (
        <ScoutEmissionCard
          key={emission.id}
          emission={emission}
          skillName={run.skill_name}
          linkedReport={reportBySourceId.get(emission.source_id)}
          defaultExpanded={emission.id === highlightFindingId}
          highlighted={emission.id === highlightFindingId}
          actions={
            <>
              <ScoutFindingDiscussButton
                emission={emission}
                skillName={run.skill_name}
              />
              <ScoutFindingShareButton
                emission={emission}
                skillName={run.skill_name}
              />
            </>
          }
          footerEnd={
            taskRunUrl ? (
              <ScoutTaskRunLink run={run} taskRunUrl={taskRunUrl} />
            ) : undefined
          }
        />
      ))}
    </Flex>
  );
}
