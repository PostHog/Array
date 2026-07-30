import { ChatCircleIcon } from "@phosphor-icons/react";
import type { ResourceComment } from "@posthog/api-client/posthog-client";
import type { RegionCommentAnchor } from "@posthog/core/comments/anchors";
import type { UserBasic } from "@posthog/shared/domain-types";
import type { EditorSelection } from "@posthog/ui/features/code-editor/components/CodeMirrorEditor";
import { SelectionCommentOverlay } from "@posthog/ui/features/code-editor/components/SelectionCommentOverlay";
import { ZoomableImage } from "@posthog/ui/primitives/SafeImagePreview";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  type CommentLocateRequest,
  readCommentContext,
} from "./commentViewTypes";

function ImageCommentCreationLayer({
  name,
  members,
  onCreate,
  onCancel,
}: {
  name: string;
  members: UserBasic[];
  onCreate: (
    anchor: RegionCommentAnchor,
    content: string,
    mentions?: number[],
  ) => void;
  onCancel: () => void;
}) {
  const [pendingAnchor, setPendingAnchor] =
    useState<RegionCommentAnchor | null>(null);
  const [selection, setSelection] = useState<EditorSelection | null>(null);

  return (
    <>
      <button
        type="button"
        aria-label="Place image comment"
        className="absolute inset-0 z-20 cursor-crosshair"
        onClick={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          const keyboard = event.detail === 0;
          const clientX = keyboard ? box.left + box.width / 2 : event.clientX;
          const clientY = keyboard ? box.top + box.height / 2 : event.clientY;
          const x = (clientX - box.left) / box.width;
          const y = (clientY - box.top) / box.height;
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
              top: clientY + 4,
              left: Math.min(clientX + 4, window.innerWidth - 440),
            },
          });
        }}
      />
      <SelectionCommentOverlay
        selection={selection}
        open={!!selection && !!pendingAnchor}
        filePath={name}
        actionLabel="Add image comment"
        placeholder="Add a comment about this part of the image..."
        initiallyExpanded
        members={members}
        onDismiss={onCancel}
        onSubmit={(_start, _end, content, mentions) => {
          if (pendingAnchor) onCreate(pendingAnchor, content, mentions);
          onCancel();
        }}
      />
    </>
  );
}

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
  comments: ResourceComment[];
  activeThreadId: string | null;
  locateRequest: CommentLocateRequest | null;
  commenting: boolean;
  members: UserBasic[];
  onCommentingChange: (commenting: boolean) => void;
  onActivateThread: (id: string) => void;
  onCreate: (
    anchor: RegionCommentAnchor,
    content: string,
    mentions?: number[],
  ) => void;
  onError: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

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
        const context = readCommentContext(comment);
        return context?.anchor.kind === "region"
          ? [{ comment, anchor: context.anchor }]
          : [];
      }),
    [comments],
  );

  // Takes the zoom scale so a pin keeps its on-screen size: the overlay is
  // inside the transformed content, so it would otherwise grow with the image.
  const overlay = (scale: number) => (
    <>
      {commenting && (
        <ImageCommentCreationLayer
          name={name}
          members={members}
          onCreate={onCreate}
          onCancel={() => onCommentingChange(false)}
        />
      )}
      <div className="pointer-events-none absolute inset-0 z-30">
        {regionComments.map(({ comment, anchor }) => (
          // A marker, not a quill Button: that one nudges itself down on press
          // and keeps a dark focus ring afterwards, both of which read as a
          // glitch on something pinned to a picture.
          <button
            key={comment.id}
            type="button"
            aria-label="Open image comment thread"
            title={comment.content ?? "Comment"}
            data-image-comment-id={comment.id}
            className={`pointer-events-auto absolute flex size-6 items-center justify-center rounded-full bg-(--yellow-9) text-(--gray-12) ring-(--gray-a7) transition-[box-shadow] hover:bg-(--yellow-10) focus-visible:outline-2 focus-visible:outline-(--yellow-11) focus-visible:outline-offset-1 ${
              comment.id === activeThreadId ? "ring-2" : "ring-1"
            }`}
            style={{
              left: `${(anchor.x + anchor.width / 2) * 100}%`,
              top: `${(anchor.y + anchor.height / 2) * 100}%`,
              transform: `translate(-50%, -50%) scale(${1 / scale})`,
            }}
            onClick={() => onActivateThread(comment.id)}
          >
            <ChatCircleIcon size={13} weight="fill" />
          </button>
        ))}
      </div>
    </>
  );

  return (
    <div
      ref={rootRef}
      className="relative size-full overflow-hidden bg-(--gray-2) p-4"
    >
      <ZoomableImage
        src={src}
        alt={name}
        controls
        overlay={overlay}
        className="size-full"
        onError={onError}
      />
    </div>
  );
}
