import { ChatCircleIcon } from "@phosphor-icons/react";
import type { ArtifactComment } from "@posthog/api-client/posthog-client";
import type { RegionArtifactAnchor } from "@posthog/core/artifact-comments/anchors";
import { Button } from "@posthog/quill";
import type { UserBasic } from "@posthog/shared/domain-types";
import type { EditorSelection } from "@posthog/ui/features/code-editor/components/CodeMirrorEditor";
import { SelectionCommentOverlay } from "@posthog/ui/features/code-editor/components/SelectionCommentOverlay";
import { ZoomableImage } from "@posthog/ui/primitives/SafeImagePreview";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  type ArtifactLocateRequest,
  parseArtifactCommentContext,
} from "./ArtifactTextAnnotations";

type Box = { left: number; top: number; width: number; height: number };

export function AnnotatedArtifactImage({
  src,
  name,
  comments,
  activeThreadId,
  locateRequest,
  commenting,
  members,
  onCommentingChange,
  onActivateThread,
  onCreate,
  onError,
}: {
  src: string;
  name: string;
  comments: ArtifactComment[];
  activeThreadId: string | null;
  locateRequest: ArtifactLocateRequest | null;
  commenting: boolean;
  members: UserBasic[];
  onCommentingChange: (commenting: boolean) => void;
  onActivateThread: (id: string) => void;
  onCreate: (
    anchor: RegionArtifactAnchor,
    content: string,
    mentions?: number[],
  ) => void;
  onError: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [imageBox, setImageBox] = useState<Box | null>(null);
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

  useEffect(() => {
    if (!locateRequest) return;
    rootRef.current
      ?.querySelector<HTMLElement>(
        `[data-image-comment-id="${CSS.escape(locateRequest.id)}"]`,
      )
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [locateRequest]);

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

  useEffect(() => {
    if (commenting) return;
    setPendingAnchor(null);
    setSelection(null);
  }, [commenting]);

  const dismiss = () => {
    setPendingAnchor(null);
    setSelection(null);
    onCommentingChange(false);
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
            <Button
              key={comment.id}
              size="icon-sm"
              variant="primary"
              aria-label="Open image comment thread"
              title={comment.content ?? "Comment"}
              data-image-comment-id={comment.id}
              className={`pointer-events-auto absolute z-10 rounded-full shadow-md ${
                comment.id === activeThreadId ? "ring-2 ring-white/80" : ""
              }`}
              style={{
                left: `${(anchor.x + anchor.width / 2) * 100}%`,
                top: `${(anchor.y + anchor.height / 2) * 100}%`,
                transform:
                  anchor.y < 0.15
                    ? "translate(-50%, 8px)"
                    : "translate(-50%, calc(-100% - 8px))",
              }}
              onClick={(event) => {
                event.stopPropagation();
                onActivateThread(comment.id);
              }}
            >
              <ChatCircleIcon weight="fill" />
            </Button>
          ))}
        </section>
      )}
      <SelectionCommentOverlay
        selection={selection}
        open={!!selection && !!pendingAnchor}
        filePath={name}
        actionLabel="Add image comment"
        placeholder="Add a comment about this part of the image..."
        initiallyExpanded
        members={members}
        onDismiss={dismiss}
        onSubmit={(_start, _end, content, mentions) => {
          if (pendingAnchor) onCreate(pendingAnchor, content, mentions);
          dismiss();
        }}
      />
    </div>
  );
}
