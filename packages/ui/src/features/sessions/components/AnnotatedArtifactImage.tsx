import { ChatCircle, X } from "@phosphor-icons/react";
import type { ArtifactComment } from "@posthog/api-client/posthog-client";
import type { RegionArtifactAnchor } from "@posthog/core/artifact-comments/anchors";
import { Button } from "@posthog/quill";
import type { EditorSelection } from "@posthog/ui/features/code-editor/components/CodeMirrorEditor";
import { SelectionCommentOverlay } from "@posthog/ui/features/code-editor/components/SelectionCommentOverlay";
import { ZoomableImage } from "@posthog/ui/primitives/SafeImagePreview";
import { useEffect, useMemo, useRef, useState } from "react";
import { parseArtifactCommentContext } from "./ArtifactTextAnnotations";

type Box = { left: number; top: number; width: number; height: number };

export function AnnotatedArtifactImage({
  src,
  name,
  comments,
  activeThreadId,
  onActivateThread,
  onCreate,
  onError,
}: {
  src: string;
  name: string;
  comments: ArtifactComment[];
  activeThreadId: string | null;
  onActivateThread: (id: string) => void;
  onCreate: (anchor: RegionArtifactAnchor, content: string) => void;
  onError: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [imageBox, setImageBox] = useState<Box | null>(null);
  const [commenting, setCommenting] = useState(false);
  const [pendingAnchor, setPendingAnchor] =
    useState<RegionArtifactAnchor | null>(null);
  const [selection, setSelection] = useState<EditorSelection | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    const image = root?.querySelector("img");
    if (!root || !image) return;
    const update = () => {
      const rootBox = root.getBoundingClientRect();
      const box = image.getBoundingClientRect();
      const next = {
        left: box.left - rootBox.left,
        top: box.top - rootBox.top,
        width: box.width,
        height: box.height,
      };
      setImageBox((previous) =>
        previous &&
        Math.abs(previous.left - next.left) < 0.5 &&
        Math.abs(previous.top - next.top) < 0.5 &&
        Math.abs(previous.width - next.width) < 0.5 &&
        Math.abs(previous.height - next.height) < 0.5
          ? previous
          : next,
      );
    };
    update();
    const resizeObserver = new ResizeObserver(update);
    resizeObserver.observe(root);
    resizeObserver.observe(image);
    const transformObserver = new MutationObserver(update);
    transformObserver.observe(root, {
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "class"],
    });
    window.addEventListener("resize", update);
    return () => {
      resizeObserver.disconnect();
      transformObserver.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  const regionComments = useMemo(
    () =>
      comments.flatMap((comment) => {
        if (comment.source_comment) return [];
        const context = parseArtifactCommentContext(comment);
        return context?.anchor.kind === "region"
          ? [{ comment, anchor: context.anchor }]
          : [];
      }),
    [comments],
  );

  const dismiss = () => {
    setPendingAnchor(null);
    setSelection(null);
    setCommenting(false);
  };

  const openComposer = (
    x: number,
    y: number,
    viewportLeft: number,
    viewportTop: number,
  ) => {
    const size = 0.035;
    setPendingAnchor({
      kind: "region",
      x: Math.max(0, x - size / 2),
      y: Math.max(0, y - size / 2),
      width: size,
      height: size,
    });
    setSelection({
      text: "Image region",
      fromLine: 1,
      toLine: 1,
      anchor: {
        top: viewportTop + 4,
        left: Math.min(viewportLeft + 4, window.innerWidth - 440),
      },
    });
  };

  return (
    <div
      ref={rootRef}
      className="relative size-full overflow-hidden bg-(--gray-2) p-4"
    >
      <ZoomableImage
        src={src}
        alt={name}
        controls
        className="size-full"
        onError={onError}
      />
      <Button
        size="sm"
        variant={commenting ? "primary" : "outline"}
        className="absolute top-3 right-3 z-30 shadow-sm"
        onClick={() => setCommenting((value) => !value)}
      >
        {commenting ? <X /> : <ChatCircle />}
        {commenting ? "Cancel" : "Comment on image"}
      </Button>
      {imageBox && (
        <section
          aria-label="Image annotation canvas"
          tabIndex={commenting ? 0 : -1}
          className={`absolute z-20 ${commenting ? "cursor-crosshair" : "pointer-events-none"}`}
          style={imageBox}
          onKeyDown={(event) => {
            if (commenting && (event.key === "Enter" || event.key === " ")) {
              event.preventDefault();
              const box = event.currentTarget.getBoundingClientRect();
              openComposer(
                0.5,
                0.5,
                box.left + box.width / 2,
                box.top + box.height / 2,
              );
            }
          }}
          onClick={(event) => {
            if (!commenting) return;
            const box = event.currentTarget.getBoundingClientRect();
            openComposer(
              (event.clientX - box.left) / box.width,
              (event.clientY - box.top) / box.height,
              event.clientX,
              event.clientY,
            );
          }}
        >
          {regionComments.map(({ comment, anchor }) => (
            <button
              key={comment.id}
              type="button"
              aria-label="Open image comment thread"
              className={`pointer-events-auto absolute rounded-sm border-2 ${
                comment.id === activeThreadId
                  ? "border-yellow-600 bg-yellow-300/45"
                  : "border-yellow-500 bg-yellow-200/30 hover:bg-yellow-200/50"
              }`}
              style={{
                left: `${anchor.x * 100}%`,
                top: `${anchor.y * 100}%`,
                width: `${anchor.width * 100}%`,
                height: `${anchor.height * 100}%`,
              }}
              onClick={(event) => {
                event.stopPropagation();
                onActivateThread(comment.id);
              }}
            />
          ))}
        </section>
      )}
      <SelectionCommentOverlay
        selection={selection}
        open={!!selection && !!pendingAnchor}
        filePath={name}
        actionLabel="Add image comment"
        placeholder="Add a comment about this part of the image..."
        onDismiss={dismiss}
        onSubmit={(_start, _end, content) => {
          if (pendingAnchor) onCreate(pendingAnchor, content);
          dismiss();
        }}
      />
    </div>
  );
}
