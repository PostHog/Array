import type {
  HtmlCanvasAnnotation,
  HtmlCanvasRect,
} from "@posthog/core/canvas/htmlCanvasSchemas";
import { Button, Textarea } from "@posthog/quill";
import {
  useAddCanvasComment,
  useCanvasComments,
} from "@posthog/ui/features/canvas/hooks/useCanvasComments";
import { useCanvasCommentsStore } from "@posthog/ui/features/canvas/stores/canvasCommentsStore";
import { logger } from "@posthog/ui/shell/logger";
import { Box, Flex } from "@radix-ui/themes";
import { useCallback, useEffect, useMemo, useState } from "react";
import { HtmlArtifactFrame } from "./HtmlArtifactFrame";

const log = logger.scope("html-canvas-body");

const COMPOSER_WIDTH = 320;

// The HTML-artifact canvas body: the sandboxed document plus the peek-style
// comment affordances — select text → floating "+" → composer, or element
// pick mode → click → composer. The iframe fills this wrapper, so the shim's
// viewport rects are wrapper coordinates directly (no offset math).
export function HtmlCanvasBody({
  dashboardId,
  html,
  canvasVersionId,
  onOpenThread,
}: {
  dashboardId: string;
  html: string;
  canvasVersionId?: string;
  /** Open the given comment thread in the side panel. */
  onOpenThread: (id: string) => void;
}) {
  const pickMode = useCanvasCommentsStore((s) => s.pickMode);
  const activeCommentId = useCanvasCommentsStore((s) => s.activeCommentId);
  const draft = useCanvasCommentsStore((s) => s.draft);
  const setDraft = useCanvasCommentsStore((s) => s.setDraft);
  const setPickMode = useCanvasCommentsStore((s) => s.setPickMode);
  const setActiveCommentId = useCanvasCommentsStore(
    (s) => s.setActiveCommentId,
  );
  const setResolved = useCanvasCommentsStore((s) => s.setResolved);
  const reset = useCanvasCommentsStore((s) => s.reset);

  // Comment state is per-canvas; entering another canvas starts clean.
  useEffect(() => {
    reset();
    return () => reset();
  }, [reset]);

  const { threads } = useCanvasComments(dashboardId);
  const { addComment, isAdding } = useAddCanvasComment(dashboardId);

  // Roots with a parseable anchor become paintable annotations (page anchors
  // resolve trivially and paint nothing; null anchors can't be painted).
  const annotations = useMemo<HtmlCanvasAnnotation[]>(
    () =>
      threads.flatMap((t) =>
        t.root.anchor
          ? [{ id: t.root.id, index: t.index, anchor: t.root.anchor }]
          : [],
      ),
    [threads],
  );

  const onSelection = useCallback(
    (anchor: HtmlCanvasAnnotation["anchor"], rect: HtmlCanvasRect) => {
      // A fresh selection replaces any pending affordance, but never an open
      // composer (typing there must not lose the draft).
      const current = useCanvasCommentsStore.getState().draft;
      if (current?.composing) return;
      setDraft({ anchor, rect, composing: false });
    },
    [setDraft],
  );

  const onSelectionCleared = useCallback(() => {
    const current = useCanvasCommentsStore.getState().draft;
    if (current && !current.composing) setDraft(null);
  }, [setDraft]);

  const onElementPicked = useCallback(
    (anchor: HtmlCanvasAnnotation["anchor"], rect: HtmlCanvasRect) => {
      setDraft({ anchor, rect, composing: true });
      setPickMode(false);
    },
    [setDraft, setPickMode],
  );

  const onMarkerClicked = useCallback(
    (id: string) => {
      setActiveCommentId(id);
      onOpenThread(id);
    },
    [setActiveCommentId, onOpenThread],
  );

  const onAnnotationsResolved = useCallback(
    (results: { id: string; resolved: boolean }[]) => {
      setResolved(Object.fromEntries(results.map((r) => [r.id, r.resolved])));
    },
    [setResolved],
  );

  const onError = useCallback((message: string) => {
    // Shim errors are non-fatal — the document still renders.
    log.warn("annotation shim error", { message });
  }, []);

  const submitDraft = useCallback(
    async (content: string) => {
      const current = useCanvasCommentsStore.getState().draft;
      if (!current) return;
      const created = await addComment({
        content,
        anchor: current.anchor,
        canvasVersionId,
      });
      setDraft(null);
      if (created) setActiveCommentId(created.id);
    },
    [addComment, canvasVersionId, setDraft, setActiveCommentId],
  );

  return (
    <Box position="relative" className="h-full w-full overflow-hidden">
      <HtmlArtifactFrame
        html={html}
        annotations={annotations}
        pickMode={pickMode}
        activeId={activeCommentId}
        hasDraft={!!draft}
        onSelection={onSelection}
        onSelectionCleared={onSelectionCleared}
        onElementPicked={onElementPicked}
        onMarkerClicked={onMarkerClicked}
        onAnnotationsResolved={onAnnotationsResolved}
        onError={onError}
      />
      {draft?.rect && !draft.composing && (
        <button
          type="button"
          aria-label="Comment on selection"
          onClick={() => setDraft({ ...draft, composing: true })}
          className="absolute z-30 flex size-7 items-center justify-center rounded-full border border-border bg-primary text-primary-foreground shadow-md transition-transform hover:scale-110"
          style={{
            left: `clamp(8px, ${draft.rect.left + draft.rect.width / 2 - 14}px, calc(100% - 36px))`,
            top: `clamp(8px, ${draft.rect.top - 34}px, calc(100% - 36px))`,
          }}
        >
          <span className="font-semibold text-[15px] leading-none">+</span>
        </button>
      )}
      {draft?.composing && (
        <DraftComposer
          rect={draft.rect}
          isSubmitting={isAdding}
          onSubmit={submitDraft}
          onCancel={() => setDraft(null)}
        />
      )}
    </Box>
  );
}

// The floating composer card, anchored under the draft's rect (or centered
// for a rect-less draft). Escape cancels; Cmd/Ctrl+Enter submits.
function DraftComposer({
  rect,
  isSubmitting,
  onSubmit,
  onCancel,
}: {
  rect: HtmlCanvasRect | null;
  isSubmitting: boolean;
  onSubmit: (content: string) => void;
  onCancel: () => void;
}) {
  const [content, setContent] = useState("");
  const canSubmit = content.trim().length > 0 && !isSubmitting;

  const style = rect
    ? {
        left: `clamp(8px, ${rect.left + rect.width / 2 - COMPOSER_WIDTH / 2}px, calc(100% - ${COMPOSER_WIDTH + 8}px))`,
        top: `clamp(8px, ${rect.top + rect.height + 8}px, calc(100% - 148px))`,
      }
    : { left: `calc(50% - ${COMPOSER_WIDTH / 2}px)`, top: "24px" };

  return (
    <Flex
      direction="column"
      gap="2"
      className="absolute z-30 rounded-lg border border-border bg-card p-2 shadow-lg"
      style={{ width: COMPOSER_WIDTH, ...style }}
    >
      <Textarea
        autoFocus
        rows={3}
        placeholder="Add a comment…"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canSubmit) {
            onSubmit(content.trim());
          }
        }}
      />
      <Flex justify="end" gap="2">
        <Button size="sm" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={!canSubmit}
          onClick={() => onSubmit(content.trim())}
        >
          {isSubmitting ? "Commenting…" : "Comment"}
        </Button>
      </Flex>
    </Flex>
  );
}
