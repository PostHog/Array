import type { ArtifactComment } from "@posthog/api-client/posthog-client";
import {
  type ArtifactCommentContext,
  artifactCommentContextSchema,
  createTextArtifactAnchor,
  resolveTextArtifactAnchor,
  type TextArtifactAnchor,
} from "@posthog/core/artifact-comments/anchors";
import type { EditorSelection } from "@posthog/ui/features/code-editor/components/CodeMirrorEditor";
import { SelectionCommentOverlay } from "@posthog/ui/features/code-editor/components/SelectionCommentOverlay";
import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

export type HighlightResolution = "exact" | "reanchored" | "orphaned";

type HighlightRect = {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
  active: boolean;
};

export function parseArtifactCommentContext(
  comment: ArtifactComment,
): ArtifactCommentContext | null {
  const parsed = artifactCommentContextSchema.safeParse(comment.item_context);
  return parsed.success ? parsed.data : null;
}

function rangeFromOffsets(
  root: HTMLElement,
  start: number,
  end: number,
): Range | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let offset = 0;
  let startNode: Text | null = null;
  let endNode: Text | null = null;
  let startOffset = 0;
  let endOffset = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    const next = offset + text.data.length;
    if (!startNode && start >= offset && start <= next) {
      startNode = text;
      startOffset = start - offset;
    }
    if (end >= offset && end <= next) {
      endNode = text;
      endOffset = end - offset;
      break;
    }
    offset = next;
  }
  if (!startNode || !endNode) return null;
  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  return range;
}

function selectionOffsets(root: HTMLElement, range: Range) {
  const before = document.createRange();
  before.selectNodeContents(root);
  before.setEnd(range.startContainer, range.startOffset);
  const through = document.createRange();
  through.selectNodeContents(root);
  through.setEnd(range.endContainer, range.endOffset);
  return { start: before.toString().length, end: through.toString().length };
}

interface ArtifactTextAnnotationsProps {
  artifactName: string;
  rootRef: RefObject<HTMLElement | null>;
  containerRef: RefObject<HTMLElement | null>;
  comments: ArtifactComment[];
  activeThreadId: string | null;
  onActivateThread: (id: string) => void;
  onCreate: (anchor: TextArtifactAnchor, content: string) => void;
  onResolutionsChange: (resolutions: Map<string, HighlightResolution>) => void;
}

export function ArtifactTextAnnotations({
  artifactName,
  rootRef,
  containerRef,
  comments,
  activeThreadId,
  onActivateThread,
  onCreate,
  onResolutionsChange,
}: ArtifactTextAnnotationsProps) {
  const [selection, setSelection] = useState<EditorSelection | null>(null);
  const [pendingAnchor, setPendingAnchor] = useState<TextArtifactAnchor | null>(
    null,
  );
  const [rects, setRects] = useState<HighlightRect[]>([]);

  const rootComments = useMemo(
    () => comments.filter((comment) => !comment.source_comment),
    [comments],
  );

  const recalculate = useCallback(() => {
    const root = rootRef.current;
    const container = containerRef.current;
    if (!root || !container) return;
    const text = root.textContent ?? "";
    const containerBox = container.getBoundingClientRect();
    const nextRects: HighlightRect[] = [];
    const resolutions = new Map<string, HighlightResolution>();

    for (const comment of rootComments) {
      const context = parseArtifactCommentContext(comment);
      if (!context || context.anchor.kind !== "text") continue;
      const resolved = resolveTextArtifactAnchor(text, context.anchor);
      if (!resolved) {
        resolutions.set(comment.id, "orphaned");
        continue;
      }
      resolutions.set(comment.id, resolved.status);
      const range = rangeFromOffsets(root, resolved.start, resolved.end);
      if (!range) continue;
      for (const box of range.getClientRects()) {
        nextRects.push({
          id: comment.id,
          left: box.left - containerBox.left + container.scrollLeft,
          top: box.top - containerBox.top + container.scrollTop,
          width: box.width,
          height: box.height,
          active: comment.id === activeThreadId,
        });
      }
    }
    setRects(nextRects);
    onResolutionsChange(resolutions);
  }, [
    activeThreadId,
    containerRef,
    onResolutionsChange,
    rootComments,
    rootRef,
  ]);

  useEffect(() => {
    recalculate();
    const container = containerRef.current;
    const root = rootRef.current;
    if (!container || !root) return;
    const observer = new ResizeObserver(recalculate);
    observer.observe(root);
    window.addEventListener("resize", recalculate);
    container.addEventListener("scroll", recalculate, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", recalculate);
      container.removeEventListener("scroll", recalculate);
    };
  }, [containerRef, recalculate, rootRef]);

  useEffect(() => {
    const container = containerRef.current;
    const root = rootRef.current;
    if (!container || !root) return;
    const handleMouseUp = () => {
      const domSelection = window.getSelection();
      if (
        !domSelection ||
        domSelection.isCollapsed ||
        domSelection.rangeCount === 0
      ) {
        return;
      }
      const range = domSelection.getRangeAt(0);
      if (
        !root.contains(range.startContainer) ||
        !root.contains(range.endContainer)
      ) {
        return;
      }
      const offsets = selectionOffsets(root, range);
      const anchor = createTextArtifactAnchor(
        root.textContent ?? "",
        offsets.start,
        offsets.end,
      );
      if (!anchor) return;
      const box = range.getBoundingClientRect();
      setPendingAnchor(anchor);
      setSelection({
        text: anchor.quote,
        fromLine: offsets.start + 1,
        toLine: offsets.end + 1,
        anchor: {
          top: box.bottom,
          left: Math.min(box.right, window.innerWidth - 440),
        },
      });
    };
    container.addEventListener("mouseup", handleMouseUp);
    return () => container.removeEventListener("mouseup", handleMouseUp);
  }, [containerRef, rootRef]);

  const dismiss = useCallback(() => {
    setSelection(null);
    setPendingAnchor(null);
    window.getSelection()?.removeAllRanges();
  }, []);

  return (
    <>
      <div className="pointer-events-none absolute inset-0 z-10" aria-hidden>
        {rects.map((rect, index) => (
          <button
            // A selection can span several DOM rectangles, hence the index.
            key={`${rect.id}-${index}`}
            type="button"
            tabIndex={-1}
            className={`pointer-events-auto absolute rounded-[2px] ${
              rect.active
                ? "bg-yellow-400/55 ring-2 ring-yellow-500"
                : "bg-yellow-300/35 hover:bg-yellow-300/55"
            }`}
            style={{
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
            }}
            onClick={() => onActivateThread(rect.id)}
            aria-label="Open comment thread"
          />
        ))}
      </div>
      <SelectionCommentOverlay
        selection={selection}
        open={!!selection && !!pendingAnchor}
        filePath={artifactName}
        actionLabel="Add comment"
        placeholder="Add a comment about this selection..."
        onDismiss={dismiss}
        onSubmit={(_start, _end, content) => {
          if (pendingAnchor) onCreate(pendingAnchor, content);
          dismiss();
        }}
      />
    </>
  );
}
