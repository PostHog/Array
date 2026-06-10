import {
  ArrowLeftIcon,
  ArrowSquareOutIcon,
  BrainIcon,
  CompassIcon,
  TerminalIcon,
} from "@phosphor-icons/react";
import type { ScoutScratchpadEntry } from "@posthog/api-client/posthog-client";
import {
  deriveRunFailureKind,
  formatRunDuration,
  normalizeRunStatus,
  prettifyScoutSkillName,
  runDurationSeconds,
  scoutSkillNameFromSlug,
} from "@posthog/core/scouts/scoutPresentation";
import { getCloudUrlFromRegion } from "@posthog/shared";
import { useAuthStateValue } from "@posthog/ui/features/auth/store";
import { MarkdownRenderer } from "@posthog/ui/features/editor/components/MarkdownRenderer";
import { DetailSection } from "@posthog/ui/features/inbox/components/DetailSection";
import { useSetHeaderContent } from "@posthog/ui/hooks/useSetHeaderContent";
import { RelativeTimestamp } from "@posthog/ui/primitives/RelativeTimestamp";
import { Badge, Box, Flex, Text } from "@radix-ui/themes";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useScoutRun } from "../hooks/useScoutRun";
import { useScoutRunEmissions } from "../hooks/useScoutRunEmissions";
import { useScoutScratchpad } from "../hooks/useScoutScratchpad";
import { ScoutEmissionCard } from "./ScoutEmissionCard";

export function ScoutRunDetailView({
  skillSlug,
  runId,
}: {
  skillSlug: string;
  runId: string;
}) {
  const skillName = scoutSkillNameFromSlug(skillSlug);
  const displayName = prettifyScoutSkillName(skillName);

  const headerContent = useMemo(
    () => (
      <Flex align="center" gap="2" className="w-full min-w-0">
        <CompassIcon size={12} className="shrink-0 text-gray-10" />
        <Text
          className="truncate whitespace-nowrap font-medium text-[13px]"
          title={`${displayName} run`}
        >
          {displayName} · run
        </Text>
      </Flex>
    ),
    [displayName],
  );
  useSetHeaderContent(headerContent);

  const { data: run, isLoading: runLoading } = useScoutRun(runId);
  const emitted = (run?.emitted_count ?? 0) > 0;
  const { data: emissions, isLoading: emissionsLoading } = useScoutRunEmissions(
    runId,
    { enabled: emitted },
  );
  const { data: scratchpad } = useScoutScratchpad();
  const cloudRegion = useAuthStateValue((state) => state.cloudRegion);

  const memoryEntries = useMemo(
    () =>
      (scratchpad ?? []).filter((entry) => entry.created_by_run_id === runId),
    [scratchpad, runId],
  );

  const now = new Date();
  const status = run ? normalizeRunStatus(run.status) : "unknown";
  const failureKind = run ? deriveRunFailureKind(run, now) : null;
  const duration = run ? formatRunDuration(runDurationSeconds(run, now)) : "";
  const taskLogUrl =
    run?.task_url && cloudRegion
      ? `${getCloudUrlFromRegion(cloudRegion)}${run.task_url}`
      : null;

  return (
    <Flex direction="column" className="h-full min-h-0">
      <Flex
        direction="column"
        gap="0.5"
        className="cursor-default select-none border-(--gray-5) border-b px-6 pt-5 pb-5"
      >
        <Link
          to="/code/agents/scouts/$skillName"
          params={{ skillName: skillSlug }}
          className="mb-1 flex w-fit items-center gap-1 text-[12px] text-gray-10 no-underline hover:text-gray-12"
        >
          <ArrowLeftIcon size={12} />
          {displayName}
        </Link>
        <Flex align="center" gap="3" wrap="wrap">
          <Text className="font-bold text-[22px] text-gray-12 leading-tight tracking-tight">
            Run
          </Text>
          {run ? (
            <>
              <RelativeTimestamp timestamp={run.started_at} />
              <RunStatusBadge
                status={status}
                emitted={emitted}
                failureKind={failureKind}
              />
              {duration ? (
                <Text className="text-[12px] text-gray-10">{duration}</Text>
              ) : null}
            </>
          ) : null}
        </Flex>
        {run ? (
          <Text className="font-mono text-[11px] text-gray-10">
            {run.skill_name} v{run.skill_version} · {run.run_id}
          </Text>
        ) : null}
      </Flex>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto max-w-4xl px-6 py-6">
          {runLoading && !run ? (
            <Box className="h-40 w-full animate-pulse rounded-(--radius-3) bg-(--gray-3)" />
          ) : !run ? (
            <Text className="text-[12.5px] text-gray-11">
              Run not found. It may be older than the recent window the API
              returns.
            </Text>
          ) : (
            <Flex direction="column" gap="6">
              <DetailSection Icon={CompassIcon} title="Summary">
                {run.summary ? (
                  <Box className="rounded-(--radius-2) border border-border bg-(--color-panel-solid) px-4 py-3.5 text-[13px] text-gray-11 leading-relaxed [&_p:last-child]:mb-0 [&_p]:mb-1.5">
                    <MarkdownRenderer content={run.summary} />
                  </Box>
                ) : (
                  <Flex
                    direction="column"
                    gap="1"
                    className="rounded-(--radius-2) border border-border bg-(--color-panel-solid) px-4 py-3.5"
                  >
                    <Text className="font-medium text-[13px] text-gray-12">
                      No close-out summary
                    </Text>
                    <Text className="max-w-2xl text-[12.5px] text-gray-11 leading-snug">
                      {failureKind === "timed_out"
                        ? "The run hit the 30-minute deadline before finishing. The task log is the only diagnostic for runs like this."
                        : status === "failed"
                          ? "The run failed before writing its close-out. Open the task log to see why."
                          : "The run has not written a summary yet."}
                    </Text>
                  </Flex>
                )}
              </DetailSection>

              <DetailSection
                Icon={CompassIcon}
                title={`Signals emitted (${run.emitted_count ?? 0})`}
              >
                {!emitted ? (
                  <Text className="text-[12.5px] text-gray-11">
                    Nothing emitted – on a healthy project this is the expected
                    close-out for most runs.
                  </Text>
                ) : emissionsLoading ? (
                  <Box className="h-24 w-full animate-pulse rounded-(--radius-2) bg-(--gray-3)" />
                ) : (
                  <Flex direction="column" gap="2">
                    {(emissions ?? []).map((emission) => (
                      <ScoutEmissionCard
                        key={emission.id}
                        emission={emission}
                      />
                    ))}
                  </Flex>
                )}
              </DetailSection>

              <DetailSection
                Icon={BrainIcon}
                title={`Memory written (${memoryEntries.length})`}
              >
                {memoryEntries.length === 0 ? (
                  <Text className="text-[12.5px] text-gray-11">
                    No scratchpad entries created by this run. Entries the run
                    read or updated in place aren&apos;t attributed yet, so this
                    only shows what it created.
                  </Text>
                ) : (
                  <Flex direction="column" gap="2">
                    {memoryEntries.map((entry) => (
                      <MemoryEntryCard key={entry.key} entry={entry} />
                    ))}
                  </Flex>
                )}
              </DetailSection>

              <DetailSection Icon={TerminalIcon} title="Task log">
                <Flex
                  align="center"
                  justify="between"
                  gap="4"
                  className="rounded-(--radius-2) border border-border bg-(--color-panel-solid) px-4 py-3.5"
                >
                  <Text className="max-w-2xl text-[12.5px] text-gray-11 leading-snug">
                    The full transcript lives on the backing task run in
                    PostHog. For failed runs it is the only way to see what
                    happened.
                  </Text>
                  {taskLogUrl ? (
                    <a
                      href={taskLogUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex shrink-0 items-center gap-1 text-[12.5px] text-accent-11 no-underline hover:text-accent-12"
                    >
                      Open task log
                      <ArrowSquareOutIcon size={13} />
                    </a>
                  ) : (
                    <Text className="shrink-0 text-[12px] text-gray-10">
                      No task link available
                    </Text>
                  )}
                </Flex>
              </DetailSection>
            </Flex>
          )}
        </div>
      </div>
    </Flex>
  );
}

function RunStatusBadge({
  status,
  emitted,
  failureKind,
}: {
  status: string;
  emitted: boolean;
  failureKind: "timed_out" | "error" | null;
}) {
  if (status === "failed") {
    return (
      <Badge variant="soft" color="red" size="1" className="text-[11px]">
        {failureKind === "timed_out" ? "Timed out" : "Failed"}
      </Badge>
    );
  }
  if (status === "running" || status === "queued") {
    return (
      <Badge variant="soft" color="blue" size="1" className="text-[11px]">
        {status === "running" ? "Running" : "Queued"}
      </Badge>
    );
  }
  return (
    <Badge
      variant="soft"
      color={emitted ? "iris" : "green"}
      size="1"
      className="text-[11px]"
    >
      {emitted ? "Emitted" : "Quiet"}
    </Badge>
  );
}

function MemoryEntryCard({ entry }: { entry: ScoutScratchpadEntry }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Box className="rounded-(--radius-2) border border-(--gray-6) bg-gray-1 p-3">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-2 text-left"
      >
        <Text className="min-w-0 flex-1 truncate font-mono text-[12px] text-gray-12">
          {entry.key}
        </Text>
        <RelativeTimestamp timestamp={entry.updated_at} />
      </button>
      {expanded ? (
        <Text className="mt-2 block whitespace-pre-wrap text-[12.5px] text-gray-11 leading-snug">
          {entry.content}
        </Text>
      ) : null}
    </Box>
  );
}
