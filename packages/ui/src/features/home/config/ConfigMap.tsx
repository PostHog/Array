import {
  ArrowCounterClockwise,
  CloudSlash,
  FloppyDisk,
  Warning,
} from "@phosphor-icons/react";
import { SITUATIONS } from "@posthog/core/workflow/schemas";
import { validateWorkflow } from "@posthog/core/workflow/workflowValidate";
import { Button } from "@posthog/quill";
import {
  useResetWorkflowMutation,
  useSaveWorkflowMutation,
  useWorkflow,
} from "@posthog/ui/features/home/hooks/useWorkflow";
import { useWorkflowEditorStore } from "@posthog/ui/features/home/stores/workflowEditorStore";
import { useConnectivity } from "@posthog/ui/hooks/useConnectivity";
import { toast } from "@posthog/ui/primitives/toast";
import { Box, Flex, Text } from "@radix-ui/themes";
import { useCallback, useEffect } from "react";
import { ActionEditorPanel } from "./ActionEditorPanel";
import { SituationOverviewPanel } from "./SituationOverviewPanel";
import { SituationStation } from "./SituationStation";
import { WorkflowMapArrows } from "./WorkflowMapArrows";
import { MAP_HEIGHT, MAP_WIDTH } from "./workflowMapLayout";

export function ConfigMap() {
  const { workflow, isLoading, error, refetch } = useWorkflow();
  const { isOnline } = useConnectivity();
  const draft = useWorkflowEditorStore((s) => s.draft);
  const dirty = useWorkflowEditorStore((s) => s.dirty);
  const diagnostics = useWorkflowEditorStore((s) => s.diagnostics);
  const selection = useWorkflowEditorStore((s) => s.selection);
  const beginEdit = useWorkflowEditorStore((s) => s.beginEdit);
  const setDiagnostics = useWorkflowEditorStore((s) => s.setDiagnostics);
  const clearSelection = useWorkflowEditorStore((s) => s.clearSelection);

  useEffect(() => {
    if (!workflow) return;
    if (!draft || (draft.version !== workflow.version && !dirty)) {
      beginEdit(workflow);
    }
  }, [workflow, draft, dirty, beginEdit]);

  const saveMutation = useSaveWorkflowMutation();
  const resetMutation = useResetWorkflowMutation();

  useEffect(() => {
    if (!draft) return;
    setDiagnostics(validateWorkflow(draft).diagnostics);
  }, [draft, setDiagnostics]);

  const onSave = useCallback(async () => {
    if (!draft) return;
    try {
      const result = await saveMutation.mutateAsync({
        config: draft,
        expectedVersion: draft.version,
      });
      if (result.status === "saved") {
        toast.success("Workflow saved");
        beginEdit(result.config);
        return;
      }
      if (result.status === "conflict") {
        toast.error("Workflow changed elsewhere", {
          description:
            "Another window saved a newer version. Reload to pick it up.",
        });
        return;
      }
      if (result.status === "invalid") {
        toast.error("Can't save — fix the errors below");
        setDiagnostics(result.diagnostics ?? []);
      }
    } catch (error) {
      toast.error("Failed to save workflow", {
        description:
          error instanceof Error
            ? error.message
            : "Check your connection and try again.",
      });
    }
  }, [draft, saveMutation, beginEdit, setDiagnostics]);

  const onReset = useCallback(async () => {
    try {
      const fresh = await resetMutation.mutateAsync();
      beginEdit(fresh);
      toast.success("Reset to default workflow");
    } catch (error) {
      toast.error("Failed to reset workflow", {
        description:
          error instanceof Error
            ? error.message
            : "Check your connection and try again.",
      });
    }
  }, [resetMutation, beginEdit]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === "s") {
        e.preventDefault();
        if (dirty && !saveMutation.isPending) void onSave();
      }
      if (e.key === "Escape") {
        clearSelection();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dirty, saveMutation.isPending, onSave, clearSelection]);

  if (error) {
    const offline = !isOnline;
    return (
      <Flex
        align="center"
        justify="center"
        direction="column"
        gap="2"
        className="h-full p-6 text-center"
      >
        {offline ? (
          <CloudSlash size={24} className="text-gray-9" />
        ) : (
          <Warning size={24} className="text-(--red-9)" />
        )}
        <Text className="font-medium text-[13px] text-gray-12">
          {offline ? "You're offline" : "Couldn't load workflow"}
        </Text>
        <Text className="max-w-[300px] text-[11px] text-gray-10">
          {offline
            ? "Your workflow lives on PostHog. Reconnect to view and edit it."
            : error.message}
        </Text>
        <Button
          size="xs"
          variant="primary"
          onClick={() => {
            void refetch();
          }}
        >
          Retry
        </Button>
      </Flex>
    );
  }

  if (isLoading || !workflow || !draft) {
    return (
      <Flex
        align="center"
        justify="center"
        className="h-full text-[12px] text-gray-10"
      >
        Loading workflow…
      </Flex>
    );
  }

  const errors = diagnostics.filter((d) => d.severity === "error");

  let panel: React.ReactNode = null;
  if (selection?.kind === "action") {
    const actionsForSituation = draft.bindings[selection.situationId] ?? [];
    const actionIndex = actionsForSituation.findIndex(
      (a) => a.id === selection.actionId,
    );
    const action = actionsForSituation[actionIndex];
    if (action) {
      panel = (
        <ActionEditorPanel
          situationId={selection.situationId}
          action={action}
          indexInSituation={actionIndex}
          totalInSituation={actionsForSituation.length}
        />
      );
    }
  } else if (selection?.kind === "situation") {
    panel = (
      <SituationOverviewPanel
        situationId={selection.situationId}
        actions={draft.bindings[selection.situationId] ?? []}
      />
    );
  }

  const actionCount = Object.values(draft.bindings).reduce(
    (sum, list) => sum + list.length,
    0,
  );

  return (
    <Flex direction="column" className="h-full min-h-0">
      <Box className="border-(--gray-4) border-b bg-(--gray-1) px-5 py-3">
        <Flex align="center" justify="between" gap="3">
          <Flex direction="column" gap="1">
            <Text className="font-medium text-[12px] text-gray-12">
              Workflow map
            </Text>
            <Text className="text-[11px] text-gray-10">
              v{workflow.version} · {actionCount} action
              {actionCount === 1 ? "" : "s"} bound
              {dirty ? " · unsaved changes" : ""}
            </Text>
          </Flex>
          <Flex align="center" gap="2">
            <Button
              size="xs"
              variant="link-muted"
              onClick={onReset}
              disabled={resetMutation.isPending}
            >
              <ArrowCounterClockwise size={12} />
              Reset to default
            </Button>
            <Button
              size="xs"
              variant="link-muted"
              onClick={() => beginEdit(workflow)}
              disabled={!dirty}
            >
              Discard
            </Button>
            <Button
              size="xs"
              variant="primary"
              onClick={onSave}
              disabled={!dirty || saveMutation.isPending || errors.length > 0}
            >
              <FloppyDisk size={12} />
              {saveMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </Flex>
        </Flex>
      </Box>

      {errors.length > 0 ? (
        <Box className="flex items-start gap-2 border-(--red-6) border-b bg-(--red-2) px-5 py-2 text-(--red-11) text-[12px]">
          <Warning size={14} className="mt-0.5 shrink-0" />
          <div className="flex flex-col gap-0.5">
            <Text className="font-medium">
              {errors.length} error{errors.length === 1 ? "" : "s"} — fix before
              saving
            </Text>
            <ul className="ml-1 list-disc pl-3">
              {errors.slice(0, 5).map((d, idx) => (
                <li
                  key={`${d.code}-${d.situationId ?? d.actionId ?? idx}`}
                  className="text-[11px]"
                >
                  {d.message}
                </li>
              ))}
              {errors.length > 5 ? (
                <li className="text-[11px] opacity-70">
                  …and {errors.length - 5} more
                </li>
              ) : null}
            </ul>
          </div>
        </Box>
      ) : null}

      <Flex className="min-h-0 flex-1">
        <Box className="relative min-w-0 flex-1 overflow-auto bg-(--gray-2)">
          {/* Outer wrapper carries the dot-grid background so it scrolls
              with the map content rather than getting clipped to the
              viewport on narrow displays. */}
          <div
            className="relative mx-auto"
            style={{
              width: MAP_WIDTH + 80,
              height: MAP_HEIGHT + 80,
            }}
          >
            <MapBackground />
            <div
              className="absolute"
              style={{
                left: 40,
                top: 40,
                width: MAP_WIDTH,
                height: MAP_HEIGHT,
              }}
            >
              <WorkflowMapArrows />
              {SITUATIONS.map((situation) => (
                <SituationStation
                  key={situation.id}
                  id={situation.id}
                  bindings={draft.bindings}
                />
              ))}
            </div>
          </div>
        </Box>
        {panel ? (
          <Box className="w-[360px] shrink-0 border-(--gray-4) border-l bg-(--color-panel-solid)">
            {panel}
          </Box>
        ) : null}
      </Flex>
    </Flex>
  );
}

function MapBackground() {
  return (
    <div
      className="pointer-events-none absolute inset-0"
      aria-hidden="true"
      style={{
        backgroundImage:
          "radial-gradient(circle, var(--gray-a4) 1px, transparent 1px)",
        backgroundSize: "20px 20px",
      }}
    />
  );
}
