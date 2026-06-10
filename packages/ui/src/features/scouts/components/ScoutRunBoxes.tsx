import type { ScoutRun } from "@posthog/api-client/posthog-client";
import {
  deriveRunOutcome,
  formatRunDuration,
  runDurationSeconds,
  type ScoutRunOutcome,
  scoutRunOutcomeLabel,
  scoutSkillSlug,
} from "@posthog/core/scouts/scoutPresentation";
import { formatRelativeTimeLong } from "@posthog/shared";
import { Flex, Text, Tooltip } from "@radix-ui/themes";
import { Link } from "@tanstack/react-router";

const OUTCOME_BOX_CLASS: Record<ScoutRunOutcome, string> = {
  emitted: "bg-(--iris-9)",
  quiet: "bg-(--green-7)",
  error: "bg-(--red-9)",
  timed_out: "bg-(--amber-9)",
  running: "bg-(--blue-9) animate-pulse",
  stuck: "bg-(--red-9) animate-pulse",
  queued: "bg-(--gray-6)",
  unknown: "bg-(--gray-6)",
};

const MAX_BOXES = 24;

function runTooltip(run: ScoutRun, now: Date): string {
  const parts = [scoutRunOutcomeLabel(run, now)];
  const duration = formatRunDuration(runDurationSeconds(run, now));
  if (duration) parts.push(duration);
  if (run.started_at) {
    parts.push(formatRelativeTimeLong(new Date(run.started_at).getTime()));
  }
  return parts.join(" · ");
}

/**
 * One small box per run in the visible window, oldest on the left. Each box
 * links to the run detail (status, summary, emissions, task log link).
 */
export function ScoutRunBoxes({ runs }: { runs: ScoutRun[] }) {
  if (runs.length === 0) return null;
  const visible = runs.slice(-MAX_BOXES);
  const hidden = runs.length - visible.length;
  const now = new Date();

  return (
    <Flex align="center" gap="2" className="shrink-0">
      {hidden > 0 ? (
        <Text className="text-[10px] text-gray-9">+{hidden}</Text>
      ) : null}
      <Flex align="center" gap="1">
        {visible.map((run) => {
          const outcome = deriveRunOutcome(run, now);
          const tooltip = runTooltip(run, now);
          return (
            <Tooltip key={run.run_id} content={tooltip}>
              <Link
                to="/code/agents/scouts/$skillName/runs/$runId"
                params={{
                  skillName: scoutSkillSlug(run.skill_name),
                  runId: run.run_id,
                }}
                aria-label={`Run ${tooltip}`}
                className={`block h-3 w-2 rounded-[2px] transition-transform duration-100 hover:scale-y-125 hover:ring-(--gray-8) hover:ring-1 ${OUTCOME_BOX_CLASS[outcome]}`}
              />
            </Tooltip>
          );
        })}
      </Flex>
    </Flex>
  );
}
