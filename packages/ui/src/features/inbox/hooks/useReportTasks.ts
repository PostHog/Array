import type {
  SignalReportStatus,
  Task,
  TaskRunArtefactContent,
} from "@posthog/shared/types";
import { useAuthenticatedQuery } from "@posthog/ui/hooks/useAuthenticatedQuery";

// Task↔report associations are unlabelled — a task's purpose is derived from the report's
// `task_run` artefacts (the signals pipeline writes product="signals" with one of these types;
// custom agents write their own (product, type) pair).
export type ReportTaskPurpose = "research" | "implementation" | "other";

export interface ReportTaskData {
  task: Task;
  purpose: ReportTaskPurpose;
  /** Human-readable row label — "Research" / "Implementation" / a humanized custom pair. */
  purposeLabel: string;
  startedAt: string;
}

function humanizeIdentifier(value: string): string {
  const words = value.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function derivePurpose(
  taskRun: { product: string; type: string } | undefined,
): { purpose: ReportTaskPurpose; purposeLabel: string } | null {
  if (!taskRun) {
    // Freely-associated task with no task_run artefact (e.g. an agent that associated itself
    // mid-run) — surface it generically rather than hiding it.
    return { purpose: "other", purposeLabel: "Agent task" };
  }
  if (taskRun.product === "signals") {
    if (taskRun.type === "research") {
      return { purpose: "research", purposeLabel: "Research" };
    }
    if (taskRun.type === "implementation") {
      return { purpose: "implementation", purposeLabel: "Implementation" };
    }
    // repo_selection runs are plumbing, not report work — never displayed (matches the
    // pre-derivation behavior of only showing research/implementation).
    return null;
  }
  return {
    purpose: "other",
    purposeLabel: `${humanizeIdentifier(taskRun.product)} — ${humanizeIdentifier(taskRun.type)}`,
  };
}

const PURPOSE_ORDER: ReportTaskPurpose[] = [
  "implementation",
  "research",
  "other",
];

export function useReportTasks(
  reportId: string,
  reportStatus: SignalReportStatus,
) {
  const isActive =
    reportStatus === "candidate" ||
    reportStatus === "in_progress" ||
    reportStatus === "pending_input";

  return useAuthenticatedQuery<ReportTaskData[]>(
    ["inbox", "report-tasks", reportId],
    async (client) => {
      const [reportTasks, artefacts] = await Promise.all([
        client.getSignalReportTasks(reportId),
        client.getSignalReportArtefacts(reportId),
      ]);
      // task id → its (product, type) from the report's task_run artefacts. The runtime
      // `type` check is authoritative (the generic fallback artefact keeps `type: string`
      // and defeats static narrowing).
      const taskRunByTaskId = new Map<
        string,
        { product: string; type: string }
      >();
      for (const artefact of artefacts.results) {
        if (artefact.type === "task_run") {
          const content = artefact.content as TaskRunArtefactContent;
          taskRunByTaskId.set(content.task_id, {
            product: content.product,
            type: content.type,
          });
        }
      }

      const relevant = reportTasks.flatMap((rt) => {
        const derived = derivePurpose(taskRunByTaskId.get(rt.task_id));
        return derived ? [{ rt, ...derived }] : [];
      });

      const tasks = await Promise.all(
        relevant.map(async ({ rt, purpose, purposeLabel }) => {
          const task = await client.getTask(rt.task_id);
          return {
            task,
            purpose,
            purposeLabel,
            startedAt: rt.created_at,
          };
        }),
      );
      return tasks.sort(
        (a, b) =>
          PURPOSE_ORDER.indexOf(a.purpose) - PURPOSE_ORDER.indexOf(b.purpose),
      );
    },
    {
      enabled: !!reportId,
      staleTime: isActive ? 5_000 : 10_000,
      refetchInterval: isActive ? 5_000 : false,
    },
  );
}

export function getTaskPrUrl(task: Task): string | null {
  const prUrl = task.latest_run?.output?.pr_url;
  return typeof prUrl === "string" && prUrl.length > 0 ? prUrl : null;
}
