import { XIcon } from "@phosphor-icons/react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@posthog/quill";
import { useGenerateFreeformCanvas } from "@posthog/ui/features/canvas/hooks/useGenerateFreeformCanvas";
import {
  type QueuedCanvasAnnotation,
  useCanvasAnnotations,
  useCanvasAnnotationsStore,
} from "@posthog/ui/features/canvas/stores/canvasAnnotationsStore";
import { PromptInput } from "@posthog/ui/features/message-editor/components/PromptInput";
import type { EditorHandle } from "@posthog/ui/features/message-editor/types";
import {
  type WorkspaceMode,
  WorkspaceModeSelect,
} from "@posthog/ui/features/task-detail/components/WorkspaceModeSelect";
import { forwardRef, useState } from "react";

// Composer that kicks off freeform canvas generation as a dedicated task: the
// user describes what they want and the agent builds + publishes the canvas. No
// repo is picked up front — the agent attaches one lazily only if it needs it.
// Used both for the first build (empty canvas) and for follow-up edits
// (currentCode passed in).
//
// Shares the task composer's editor (PromptInput) so it matches it exactly — @
// for files, / for skills, ↑↓ for history — but renders a blank toolbar for now:
// just the send button, none of the attach/mode/model/history addons. The
// forwarded ref exposes the editor handle so callers can prefill it (suggestion
// cards, self-repair).
export const FreeformGenerateBar = forwardRef<
  EditorHandle,
  {
    dashboardId: string;
    channelId: string;
    channelName: string;
    name: string;
    templateId?: string;
    currentCode?: string;
    // Keys the editor's draft/command state; distinct per canvas.
    sessionId: string;
    onStarted?: (taskId: string) => void;
  }
>(function FreeformGenerateBar(
  {
    dashboardId,
    channelId,
    channelName,
    name,
    templateId,
    currentCode,
    sessionId,
    onStarted,
  },
  ref,
) {
  const { generate, isStarting } = useGenerateFreeformCanvas({
    channelId,
    channelName,
  });

  // Queued comment-mode annotations for this canvas: shown as chips with an
  // inline comment field, drained into the next instruction on submit.
  const annotations = useCanvasAnnotations(dashboardId);
  const setAnnotationComment = useCanvasAnnotationsStore((s) => s.setComment);
  const removeAnnotation = useCanvasAnnotationsStore((s) => s.remove);
  const clearAnnotations = useCanvasAnnotationsStore((s) => s.clear);

  // On a FIRST build we seed the agent with a known-good starter scaffold by
  // default (faster, more consistent than authoring from scratch). Uncheck to
  // opt out and have the agent build from a blank canvas. Only meaningful on an
  // empty canvas, so the toggle is hidden in edit mode.
  const isEdit = !!currentCode?.trim();
  const [useStarter, setUseStarter] = useState(true);

  // Generation always runs in the cloud, except the dev-only picker below lets a
  // local build of these features be tested before it's merged to the cloud env.
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("cloud");

  const run = async (text: string) => {
    const instruction = text.trim();
    if (!instruction) return;
    const taskId = await generate({
      dashboardId,
      name,
      templateId,
      instruction,
      currentCode,
      useStarter: !isEdit && useStarter,
      workspaceMode,
      annotations: annotations.map((a, i) => ({
        n: i + 1,
        comment: a.comment.trim(),
        target: a.target,
      })),
    });
    if (taskId) {
      clearAnnotations(dashboardId);
      onStarted?.(taskId);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      {annotations.length > 0 && (
        <div className="flex flex-col gap-1">
          {annotations.map((a, i) => (
            <AnnotationChip
              key={a.id}
              n={i + 1}
              annotation={a}
              disabled={isStarting}
              onComment={(comment) =>
                setAnnotationComment(dashboardId, a.id, comment)
              }
              onRemove={() => removeAnnotation(dashboardId, a.id)}
            />
          ))}
        </div>
      )}
      <PromptInput
        ref={ref}
        sessionId={sessionId}
        editorHeight="large"
        disabled={isStarting}
        isLoading={isStarting}
        enableCommands
        enableBashMode={false}
        hideDefaultToolbar
        onSubmit={(text) => void run(text)}
      />
      {!isEdit && (
        <label className="flex cursor-pointer select-none items-center gap-1.5 self-start px-1 text-muted-foreground text-xs">
          <input
            type="checkbox"
            className="cursor-pointer"
            checked={useStarter}
            disabled={isStarting}
            onChange={(e) => setUseStarter(e.target.checked)}
          />
          Start from scaffold (faster, more consistent — uncheck to build from
          scratch)
        </label>
      )}
      {/* Dev-only: pick local vs cloud so a local build can be tested pre-merge. */}
      {import.meta.env.DEV && (
        <DevWorkspaceModePicker
          workspaceMode={workspaceMode}
          setWorkspaceMode={setWorkspaceMode}
          isStarting={isStarting}
        />
      )}
    </div>
  );
});

// A queued comment-mode annotation: numbered pin badge (matching the in-canvas
// pin), a bounded label of what was targeted, an inline comment field, remove.
function AnnotationChip({
  n,
  annotation,
  disabled,
  onComment,
  onRemove,
}: {
  n: number;
  annotation: QueuedCanvasAnnotation;
  disabled: boolean;
  onComment: (comment: string) => void;
  onRemove: () => void;
}) {
  const t = annotation.target;
  const label =
    t.type === "element"
      ? `<${t.tag}> ${t.text || t.ariaLabel || t.selector}`
      : `“${t.text}”`;
  return (
    <div className="flex items-center gap-1.5 rounded-md border border-border bg-muted/50 px-1.5 py-1">
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary font-semibold text-[10px] text-primary-foreground">
        {n}
      </span>
      <span
        className="max-w-36 shrink-0 truncate text-muted-foreground text-xs"
        title={label}
      >
        {label}
      </span>
      <input
        className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
        placeholder="Add a comment…"
        value={annotation.comment}
        disabled={disabled}
        onChange={(e) => onComment(e.target.value)}
      />
      <button
        type="button"
        aria-label="Remove annotation"
        className="shrink-0 text-muted-foreground hover:text-foreground"
        disabled={disabled}
        onClick={onRemove}
      >
        <XIcon size={12} />
      </button>
    </div>
  );
}

// Dev-only local/cloud picker, unchanged behavior — extracted so the main
// component stays readable with the annotation chips above the composer.
function DevWorkspaceModePicker({
  workspaceMode,
  setWorkspaceMode,
  isStarting,
}: {
  workspaceMode: WorkspaceMode;
  setWorkspaceMode: (mode: WorkspaceMode) => void;
  isStarting: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={<div className="self-start px-1" />}>
        <WorkspaceModeSelect
          value={workspaceMode}
          onChange={setWorkspaceMode}
          overrideModes={["local", "cloud"]}
          disabled={isStarting}
          size="1"
        />
      </TooltipTrigger>
      <TooltipContent>
        Dev mode only — generation always runs in the cloud in production.
      </TooltipContent>
    </Tooltip>
  );
}
