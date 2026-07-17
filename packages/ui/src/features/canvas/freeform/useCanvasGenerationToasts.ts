import {
  isNotification,
  POSTHOG_NOTIFICATIONS,
  parseWorkflowBuiltParams,
  type WorkflowBuiltPayload,
} from "@posthog/core/sessions/acpNotifications";
import { useServiceOptional } from "@posthog/di/react";
import { type AcpMessage, isJsonRpcNotification } from "@posthog/shared";
import {
  type CanvasTerminalStatus,
  hasCanvasGenerationStarted,
  isCanvasGenerating,
  resolveCanvasGenerationStatus,
} from "@posthog/ui/features/canvas/freeform/canvasGenerationStatus";
import { useDashboardMutations } from "@posthog/ui/features/canvas/hooks/useDashboards";
import { useCanvasGenerationTrackerStore } from "@posthog/ui/features/canvas/stores/canvasGenerationTrackerStore";
import { NotificationBus } from "@posthog/ui/features/notifications/notifications";
import { useSessionStore } from "@posthog/ui/features/sessions/sessionStore";
import { taskDetailQuery } from "@posthog/ui/features/tasks/queries";
import { useQueries } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";

// Poll cadence for the run status of a tracked generation task. Matches the
// canvas record poll in FreeformCanvasView so the toast and the in-view state
// land together.
const POLL_MS = 4000;

// Hand a finished canvas generation to the notification bus, which decides
// whether to suppress (user is on the canvas), toast (focused elsewhere), or
// fire a native OS notification (app backgrounded) — and threads the canvas
// target so any click lands back on the canvas.
function emitCanvasGenerationNotification(
  bus: NotificationBus,
  entry: { channelId: string; dashboardId: string; name: string },
  status: CanvasTerminalStatus,
): void {
  const name = entry.name.trim() || "Canvas";
  const target = {
    kind: "canvas" as const,
    channelId: entry.channelId,
    dashboardId: entry.dashboardId,
  };

  if (status === "completed") {
    bus.notify({
      body: `${name} is ready`,
      target,
      toast: { level: "success", description: "Generation finished." },
    });
  } else if (status === "failed") {
    bus.notify({
      body: `${name} generation failed`,
      target,
      toast: {
        level: "error",
        description: "The agent couldn't finish building this canvas.",
      },
    });
  }
  // "cancelled" is user-initiated — stay silent.
}

// The workflow link, if this run emitted one. A workflow build fires a
// `_posthog/workflow_built` notification (workflow ↔ canvas) once it has both
// created a workflow and published the canvas; we read it off the session's
// event stream - the same source SessionResourcesBar folds for resource chips -
// and persist it onto the dashboard row. Absent for regular canvas generations.
// Exported for tests.
export function findWorkflowBuilt(
  events: readonly AcpMessage[] | undefined,
): WorkflowBuiltPayload | null {
  if (!events) return null;
  for (const event of events) {
    const msg = event.message;
    if (!isJsonRpcNotification(msg)) continue;
    if (!isNotification(msg.method, POSTHOG_NOTIFICATIONS.WORKFLOW_BUILT)) {
      continue;
    }
    const parsed = parseWorkflowBuiltParams(msg.params);
    if (parsed) return parsed;
  }
  return null;
}

// Watches every canvas generation started in this client (registered in the
// tracker store) and fires a toast — with a link to the canvas — the moment each
// one stops generating. Mounted on the persistent channel layout so it keeps
// watching after the user navigates to another canvas: the whole point is to
// call them back when a backgrounded generation lands.
//
// Completion is read from the same signal the canvas view uses (isCanvasGenerating:
// the live ACP session for local runs, cloudStatus for cloud) rather than the
// dashboard's generationTaskId, which is never cleared for freeform canvases.
export function useCanvasGenerationToasts(): void {
  const tracked = useCanvasGenerationTrackerStore((s) => s.tracked);
  const untrack = useCanvasGenerationTrackerStore((s) => s.untrack);
  // The host side of the workflow link primitive: on a build that emitted one we
  // write the workflow link onto the dashboard row (the agent can't persist it
  // itself). Captured in a ref so the status-keyed effect isn't re-created by it.
  const { setWorkflow, renameDashboard } = useDashboardMutations();
  const setWorkflowRef = useRef(setWorkflow);
  setWorkflowRef.current = setWorkflow;
  // Rename the canvas to match the workflow the build created, so the breadcrumb
  // reflects the real workflow name instead of the placeholder. Kept in a ref
  // for the same reason as setWorkflow above.
  const renameDashboardRef = useRef(renameDashboard);
  renameDashboardRef.current = renameDashboard;
  // The bus is a container singleton (stable identity); capture in a ref so the
  // status-keyed effect reads it without listing it as a dependency. Optional so
  // hosts that don't bind it (web) simply no-op instead of throwing.
  const bus = useServiceOptional<NotificationBus>(NotificationBus);
  const busRef = useRef(bus);
  busRef.current = bus;

  const taskIds = useMemo(() => Object.keys(tracked), [tracked]);

  const details = useQueries({
    queries: taskIds.map((id) => ({
      ...taskDetailQuery(id),
      refetchInterval: POLL_MS,
    })),
  });

  // The live ACP sessions — for local runs this, not the run record, is what
  // tells us generation has actually finished.
  const sessions = useSessionStore((s) => s.sessions);
  const taskIdIndex = useSessionStore((s) => s.taskIdIndex);

  // Compute the "still generating?" signal per tracked task each render.
  const states = taskIds.map((id, i) => {
    const runId = taskIdIndex[id];
    const session = runId ? sessions[runId] : undefined;
    const latestRun = details[i]?.data?.latest_run;
    const generating = isCanvasGenerating({
      genTaskId: id,
      genTaskLoading: details[i]?.isLoading ?? false,
      latestRun,
      session,
    });
    return { id, generating, latestRun, session };
  });

  // A stable signature so the transition effect only runs on real changes. The
  // event count is included so the effect also re-runs as notifications stream
  // in — that's what lets the workflow link land mid-run (below).
  const sig = states
    .map(
      (s) =>
        `${s.id}:${s.generating ? 1 : 0}:${s.latestRun?.status ?? ""}:${s.session?.status ?? ""}:${s.session?.cloudStatus ?? ""}:${s.session?.isPromptPending ? 1 : 0}:${s.session?.events.length ?? 0}`,
    )
    .join("|");

  const statesRef = useRef(states);
  statesRef.current = states;
  // Tasks we've confirmed actually started running — only an armed task can
  // toast on finishing, so the create→connect gap can't fire a false toast.
  const armedRef = useRef<Set<string>>(new Set());
  // Tasks already toasted, so a re-run can never double-fire.
  const toastedRef = useRef<Set<string>>(new Set());
  // Tasks whose workflow link we've already written, so the mid-run write
  // below fires exactly once per task.
  const linkedRef = useRef<Set<string>>(new Set());

  // biome-ignore lint/correctness/useExhaustiveDependencies: sig is the trigger; states/store are read fresh (states via ref) when it changes.
  useEffect(() => {
    for (const st of statesRef.current) {
      // Persist the workflow link + name the moment the build emits it — do
      // NOT wait for the run to finish. A workflow-build agent keeps running
      // after it publishes the canvas (it summarises, and the run can linger),
      // so gating this on completion would leave the canvas untagged and
      // placeholder-named until the whole run ends.
      if (!linkedRef.current.has(st.id)) {
        const link = findWorkflowBuilt(st.session?.events);
        if (link) {
          linkedRef.current.add(st.id);
          void setWorkflowRef
            .current(link.dashboardId, {
              workflowId: link.workflowId,
              workflowStatus: link.workflowStatus,
              workflowType: link.workflowType,
            })
            .catch(() => {});
          // Name the canvas after the workflow so the breadcrumb reflects it.
          if (link.workflowName?.trim()) {
            void renameDashboardRef
              .current(link.dashboardId, link.workflowName.trim())
              .catch(() => {});
          }
        }
      }

      if (
        hasCanvasGenerationStarted({
          latestRun: st.latestRun,
          session: st.session,
        })
      ) {
        armedRef.current.add(st.id);
      }

      // A task only toasts once it has demonstrably run and is no longer
      // generating.
      if (
        !armedRef.current.has(st.id) ||
        st.generating ||
        toastedRef.current.has(st.id)
      ) {
        continue;
      }

      toastedRef.current.add(st.id);
      const entry = useCanvasGenerationTrackerStore.getState().tracked[st.id];
      if (entry && busRef.current) {
        emitCanvasGenerationNotification(
          busRef.current,
          entry,
          resolveCanvasGenerationStatus({
            latestRun: st.latestRun,
            session: st.session,
          }),
        );
      }
      // Stop tracking (and polling) this task now that it's done.
      untrack(st.id);
    }
  }, [sig, untrack]);
}

// Renders nothing; exists only to host useCanvasGenerationToasts so the frequent
// session-driven re-renders it subscribes to stay isolated here instead of
// re-rendering whatever layout mounts it.
export function CanvasGenerationToaster(): null {
  useCanvasGenerationToasts();
  return null;
}
