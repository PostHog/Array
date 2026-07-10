import {
  Binoculars,
  Code,
  Compass,
  Lightbulb,
  ListChecks,
  MagnifyingGlass,
  TestTube,
} from "@phosphor-icons/react";
import type { AutoresearchRun } from "@posthog/core/autoresearch/schemas";
import type { AcpMessage } from "@posthog/shared";
import { Badge, Progress, Text } from "@radix-ui/themes";
import { useEffect, useMemo, useState } from "react";
import { formatDuration } from "../sessions/components/GeneratingIndicator";
import {
  type AutoresearchActivityKind,
  analyzeAutoresearchActivity,
} from "./autoresearchActivity";

export function AutoresearchObservability({
  run,
  events,
}: {
  run: AutoresearchRun;
  events: AcpMessage[];
}) {
  const now = useLiveNow(run.endedAt === null);
  const activity = useMemo(
    () => analyzeAutoresearchActivity(events, run.startedAt, run.endedAt, now),
    [events, now, run.endedAt, run.startedAt],
  );
  const lastIteration = run.iterations.at(-1);
  const hypothesis =
    activity.currentPlan?.hypothesis ?? lastIteration?.hypothesis;
  const plan = activity.currentPlan?.plan ?? lastIteration?.plan;
  const approach = activity.currentPlan?.approach ?? lastIteration?.approach;

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <section className="rounded-md border border-gray-5 p-3">
        <SectionTitle
          icon={<Lightbulb size={15} />}
          title="Current experiment"
        />
        <Detail
          label="Hypothesis"
          value={hypothesis ?? "Waiting for the agent to state a hypothesis."}
        />
        <Detail
          label="Iteration plan"
          value={
            plan ?? "The next focused experiment has not been announced yet."
          }
        />
        {approach && (
          <div className="mt-3">
            <Badge color="gray" variant="soft">
              {approach}
            </Badge>
          </div>
        )}
      </section>

      <section className="rounded-md border border-gray-5 p-3">
        <SectionTitle icon={<Compass size={15} />} title="Observed time" />
        <div className="mt-3 flex flex-col gap-2.5">
          {(Object.keys(activity.timeByKind) as AutoresearchActivityKind[]).map(
            (kind) => (
              <TimeRow
                key={kind}
                kind={kind}
                value={activity.timeByKind[kind]}
                total={Math.max(1, (run.endedAt ?? now) - run.startedAt)}
              />
            ),
          )}
        </div>
      </section>

      <section className="rounded-md border border-gray-5 p-3 lg:col-span-2">
        <SectionTitle icon={<ListChecks size={15} />} title="Live activity" />
        {activity.items.length === 0 ? (
          <Text as="p" size="1" color="gray" className="mt-2">
            Waiting for the first observable tool action.
          </Text>
        ) : (
          <ol className="mt-2 grid gap-2 sm:grid-cols-2">
            {activity.items.map((item) => (
              <li
                key={item.id}
                className="flex items-center gap-2 rounded-sm bg-gray-2 px-2.5 py-2"
              >
                <ActivityIcon kind={item.kind} />
                <Text size="1" className="min-w-0 flex-1 truncate">
                  {item.label}
                </Text>
                {item.active && <Badge color="blue">Active</Badge>}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function SectionTitle({
  icon,
  title,
}: {
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <div className="flex items-center gap-2 text-gray-11">
      {icon}
      <Text size="2" weight="medium">
        {title}
      </Text>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-3">
      <Text as="div" size="1" color="gray">
        {label}
      </Text>
      <Text as="p" size="2" className="mt-0.5 leading-5">
        {value}
      </Text>
    </div>
  );
}

const TIME_LABEL: Record<AutoresearchActivityKind, string> = {
  research: "Research",
  implementation: "Implementation",
  measurement: "Commands and measurement",
  reasoning: "Reasoning and coordination",
};

function TimeRow({
  kind,
  value,
  total,
}: {
  kind: AutoresearchActivityKind;
  value: number;
  total: number;
}) {
  const percentage = Math.round((value / total) * 100);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3">
        <Text size="1">{TIME_LABEL[kind]}</Text>
        <Text size="1" color="gray" className="tabular-nums">
          {formatDuration(value, 0)}
        </Text>
      </div>
      <Progress value={percentage} size="1" color="gray" />
    </div>
  );
}

function ActivityIcon({ kind }: { kind: AutoresearchActivityKind }) {
  if (kind === "research") return <MagnifyingGlass size={14} />;
  if (kind === "implementation") return <Code size={14} />;
  if (kind === "measurement") return <TestTube size={14} />;
  return <Binoculars size={14} />;
}

function useLiveNow(live: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [live]);
  return now;
}
