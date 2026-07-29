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
  readArtifactCommentContext,
} from "./artifactCommentViewTypes";

function ImageCommentCreationLayer({
  name,
  members,
  onCreate,
  onCancel,
}: {
  name: string;
  members: UserBasic[];
  onCreate: (
    anchor: RegionArtifactAnchor,
    content: string,
    mentions?: number[],
  ) => void;
  onCancel: () => void;
}) {
  const [pendingAnchor, setPendingAnchor] =
    useState<RegionArtifactAnchor | null>(null);
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
        const context = readArtifactCommentContext(comment);
        return context?.anchor.kind === "region"
          ? [{ comment, anchor: context.anchor }]
          : [];
      }),
    [comments],
  );

  const overlay = (
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
          <Button
            key={comment.id}
            size="icon-sm"
            variant="primary"
            aria-label="Open image comment thread"
            title={comment.content ?? "Comment"}
            data-image-comment-id={comment.id}
            className={`pointer-events-auto absolute rounded-full shadow-md ${
              comment.id === activeThreadId ? "ring-2 ring-white/80" : ""
            }`}
            style={{
              left: `${(anchor.x + anchor.width / 2) * 100}%`,
              top: `${(anchor.y + anchor.height / 2) * 100}%`,
              transform: "translate(-50%, -50%)",
            }}
            onClick={() => onActivateThread(comment.id)}
          >
            <ChatCircleIcon weight="fill" />
          </Button>
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
