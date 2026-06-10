import { ArrowRightIcon } from "@phosphor-icons/react";
import type { ScoutRun } from "@posthog/api-client/posthog-client";
import { Box, Flex, Text } from "@radix-ui/themes";
import { Link } from "@tanstack/react-router";
import { useScoutRunEmissions } from "../hooks/useScoutRunEmissions";
import { ScoutEmissionCard } from "./ScoutEmissionCard";

/**
 * The signals this scout emitted in the runs window, newest first. Emissions
 * are only fetchable per run, so each emitted run gets its own child query —
 * emitted runs are rare, so this stays a handful of requests at most.
 */
export function ScoutSignalsSection({
  runs,
  skillSlug,
  windowLabel,
  loading,
}: {
  runs: ScoutRun[];
  skillSlug: string;
  windowLabel: string;
  loading: boolean;
}) {
  const emittedRuns = runs.filter((run) => (run.emitted_count ?? 0) > 0);

  return (
    <Flex direction="column" gap="3">
      <Text className="font-semibold text-[13px] text-gray-12">Signals</Text>
      {loading ? (
        <Box className="h-24 w-full animate-pulse rounded-(--radius-2) bg-(--gray-3)" />
      ) : emittedRuns.length === 0 ? (
        <Text className="text-[12.5px] text-gray-11">
          No signals emitted in the {windowLabel}.
        </Text>
      ) : (
        <Flex direction="column" gap="2">
          {emittedRuns.map((run) => (
            <RunEmissions key={run.run_id} run={run} skillSlug={skillSlug} />
          ))}
        </Flex>
      )}
    </Flex>
  );
}

function RunEmissions({
  run,
  skillSlug,
}: {
  run: ScoutRun;
  skillSlug: string;
}) {
  const { data: emissions, isLoading } = useScoutRunEmissions(run.run_id);

  if (isLoading) {
    return (
      <Box className="h-24 w-full animate-pulse rounded-(--radius-2) bg-(--gray-3)" />
    );
  }

  return (
    <Flex direction="column" gap="2">
      {(emissions ?? []).map((emission) => (
        <ScoutEmissionCard
          key={emission.id}
          emission={emission}
          footerEnd={
            <Link
              to="/code/agents/scouts/$skillName/runs/$runId"
              params={{ skillName: skillSlug, runId: run.run_id }}
              className="inline-flex shrink-0 items-center gap-1 text-[11px] text-accent-11 no-underline hover:text-accent-12"
            >
              View run
              <ArrowRightIcon size={11} />
            </Link>
          }
        />
      ))}
    </Flex>
  );
}
