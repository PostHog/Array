import { ArrowSquareOutIcon } from "@phosphor-icons/react";
import type { ScoutRun } from "@posthog/api-client/posthog-client";
import { getPostHogUrl } from "@posthog/ui/utils/urls";
import { Box, Flex, Text } from "@radix-ui/themes";
import { useScoutRunEmissions } from "../hooks/useScoutRunEmissions";
import { ScoutEmissionCard } from "./ScoutEmissionCard";

/**
 * The signals this scout emitted in the runs window, newest first. Emissions
 * are only fetchable per run, so each emitted run gets its own child query —
 * emitted runs are rare, so this stays a handful of requests at most.
 */
export function ScoutSignalsSection({
  runs,
  windowLabel,
  loading,
}: {
  runs: ScoutRun[];
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
            <RunEmissions key={run.run_id} run={run} />
          ))}
        </Flex>
      )}
    </Flex>
  );
}

function RunEmissions({ run }: { run: ScoutRun }) {
  const { data: emissions, isLoading } = useScoutRunEmissions(run.run_id);
  const taskRunUrl = run.task_url ? getPostHogUrl(run.task_url) : null;

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
            taskRunUrl ? (
              <a
                href={taskRunUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex shrink-0 items-center gap-1 text-[11px] text-accent-11 no-underline hover:text-accent-12"
              >
                Open task run
                <ArrowSquareOutIcon size={11} />
              </a>
            ) : undefined
          }
        />
      ))}
    </Flex>
  );
}
