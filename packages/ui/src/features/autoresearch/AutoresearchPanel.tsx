import { ChartLineUp, Pause, Play, Plus, Stop } from "@phosphor-icons/react";
import type { AutoresearchService } from "@posthog/core/autoresearch/autoresearch";
import { AUTORESEARCH_SERVICE } from "@posthog/core/autoresearch/identifiers";
import type {
  AutoresearchRun,
  AutoresearchRunStatus,
} from "@posthog/core/autoresearch/schemas";
import { summarizeRun } from "@posthog/core/autoresearch/stats";
import { useServiceOptional } from "@posthog/di/react";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Button as QuillButton,
} from "@posthog/quill";
import { Badge, Button, Flex, Select, Text } from "@radix-ui/themes";
import { type ReactNode, useMemo, useState } from "react";
import { IterationsTable } from "./IterationsTable";
import { MetricChart } from "./MetricChart";
import { StartAutoresearchDialog } from "./StartAutoresearchDialog";
import { useAutoresearchRuns } from "./useAutoresearchStore";

const STATUS_BADGE: Record<
  AutoresearchRunStatus,
  { color: "blue" | "amber" | "green" | "gray" | "red"; label: string }
> = {
  running: { color: "blue", label: "Running" },
  paused: { color: "amber", label: "Paused" },
  completed: { color: "green", label: "Completed" },
  stopped: { color: "gray", label: "Stopped" },
  failed: { color: "red", label: "Failed" },
};

const END_REASON_LABEL: Record<string, string> = {
  "target-reached": "Target reached",
  "max-iterations": "Iteration budget spent",
  "stopped-by-user": "Stopped by user",
  "missing-report": "Agent stopped reporting the metric",
  "session-error": "Agent session error",
  "send-failed": "Could not message the agent",
};

const numberFormat = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 4,
});

interface AutoresearchPanelProps {
  taskId: string;
}

export function AutoresearchPanel({ taskId }: AutoresearchPanelProps) {
  const service = useServiceOptional<AutoresearchService>(AUTORESEARCH_SERVICE);
  const runs = useAutoresearchRuns(taskId);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const latestRun = runs[runs.length - 1] ?? null;
  const selectedRun =
    (selectedRunId && runs.find((run) => run.id === selectedRunId)) ||
    latestRun;

  if (!service) {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ChartLineUp size={28} />
          </EmptyMedia>
          <EmptyTitle>Autoresearch unavailable</EmptyTitle>
          <EmptyDescription>
            Autoresearch is not supported on this platform.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  if (!selectedRun) {
    return (
      <>
        <Empty className="h-full">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ChartLineUp size={28} />
            </EmptyMedia>
            <EmptyTitle>Autoresearch</EmptyTitle>
            <EmptyDescription>
              Point the agent at a metric and let it iterate: each turn it makes
              one change, measures, and reports back here.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <QuillButton
              variant="primary"
              size="default"
              onClick={() => setDialogOpen(true)}
            >
              Start autoresearch
            </QuillButton>
          </EmptyContent>
        </Empty>
        <StartAutoresearchDialog
          taskId={taskId}
          service={service}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
        />
      </>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <Flex direction="column" gap="4" p="4" className="mx-auto max-w-[760px]">
        <RunHeader
          run={selectedRun}
          runs={runs}
          service={service}
          onSelectRun={setSelectedRunId}
          onNewRun={() => setDialogOpen(true)}
        />
        <RunStats run={selectedRun} />
        <MetricChart
          iterations={selectedRun.iterations}
          direction={selectedRun.config.direction}
          targetValue={selectedRun.config.targetValue}
          metricName={selectedRun.config.metricName}
        />
        <IterationsTable
          iterations={selectedRun.iterations}
          direction={selectedRun.config.direction}
        />
      </Flex>
      <StartAutoresearchDialog
        taskId={taskId}
        service={service}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </div>
  );
}

function RunHeader({
  run,
  runs,
  service,
  onSelectRun,
  onNewRun,
}: {
  run: AutoresearchRun;
  runs: AutoresearchRun[];
  service: AutoresearchService;
  onSelectRun: (runId: string) => void;
  onNewRun: () => void;
}) {
  const badge = STATUS_BADGE[run.status];
  const isLive = run.status === "running" || run.status === "paused";

  return (
    <Flex direction="column" gap="1">
      <Flex align="center" justify="between" gap="3">
        <Flex align="center" gap="2" className="min-w-0">
          <Text size="3" weight="bold" className="truncate">
            {run.config.metricName}
          </Text>
          <Badge color="gray" size="1">
            {run.config.direction}
          </Badge>
          <Badge color={badge.color} size="1">
            {badge.label}
          </Badge>
        </Flex>
        <Flex align="center" gap="2" className="shrink-0">
          {runs.length > 1 && (
            <Select.Root value={run.id} onValueChange={onSelectRun} size="1">
              <Select.Trigger variant="soft" />
              <Select.Content>
                {runs.map((candidate, index) => (
                  <Select.Item key={candidate.id} value={candidate.id}>
                    Run {index + 1} — {STATUS_BADGE[candidate.status].label}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          )}
          {run.status === "running" && (
            <Button
              size="1"
              variant="soft"
              color="gray"
              onClick={() => service.pauseRun(run.id)}
            >
              <Pause size={12} /> Pause
            </Button>
          )}
          {run.status === "paused" && (
            <Button
              size="1"
              variant="soft"
              onClick={() => service.resumeRun(run.id)}
            >
              <Play size={12} /> Resume
            </Button>
          )}
          {isLive && (
            <Button
              size="1"
              variant="soft"
              color="red"
              onClick={() => service.stopRun(run.id)}
            >
              <Stop size={12} /> Stop
            </Button>
          )}
          {!isLive && (
            <Button size="1" variant="soft" onClick={onNewRun}>
              <Plus size={12} /> New run
            </Button>
          )}
        </Flex>
      </Flex>
      {run.endReason && (
        <Text size="1" color="gray">
          {END_REASON_LABEL[run.endReason] ?? run.endReason}
          {run.lastError ? ` — ${run.lastError}` : ""}
        </Text>
      )}
    </Flex>
  );
}

function RunStats({ run }: { run: AutoresearchRun }) {
  const summary = useMemo(() => summarizeRun(run), [run]);

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <StatCard
        label="Best"
        value={
          summary.best ? (
            <>
              {numberFormat.format(summary.best.value)}
              <Text size="1" color="gray">
                {" "}
                (iter {summary.best.index})
              </Text>
            </>
          ) : (
            "—"
          )
        }
      />
      <StatCard
        label="Last"
        value={summary.last ? numberFormat.format(summary.last.value) : "—"}
      />
      <StatCard
        label="Iterations"
        value={`${summary.iterationCount} / ${run.config.maxIterations}`}
      />
      <StatCard
        label="Target"
        value={
          run.config.targetValue === null
            ? "—"
            : numberFormat.format(run.config.targetValue)
        }
      />
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-md border border-(--gray-5) bg-(--gray-2) px-3 py-2">
      <Text as="div" size="1" color="gray">
        {label}
      </Text>
      <Text as="div" size="2" weight="medium" className="tabular-nums">
        {value}
      </Text>
    </div>
  );
}
