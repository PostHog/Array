import { ChatCircle, CrosshairSimpleIcon, XIcon } from "@phosphor-icons/react";
import type { ArtifactComment } from "@posthog/api-client/posthog-client";
import type { ArtifactAnchor } from "@posthog/core/artifact-comments/anchors";
import {
  SESSION_SERVICE,
  type SessionService,
} from "@posthog/core/sessions/sessionService";
import { useService } from "@posthog/di/react";
import { Button, Spinner } from "@posthog/quill";
import { isAllowedImageMimeType } from "@posthog/shared";
import {
  getAuthIdentity,
  useAuthStateValue,
} from "@posthog/ui/features/auth/store";
import { AUTH_SCOPED_QUERY_META } from "@posthog/ui/features/auth/useCurrentUser";
import { useQuery } from "@tanstack/react-query";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { CodeMirrorEditor } from "../../code-editor/components/CodeMirrorEditor";
import { DocumentPreviewHeader } from "../../code-editor/components/DocumentPreviewHeader";
import { MarkdownDocumentPreview } from "../../code-editor/components/MarkdownDocumentPreview";
import { AnnotatedArtifactHtml } from "./AnnotatedArtifactHtml";
import { AnnotatedArtifactImage } from "./AnnotatedArtifactImage";
import { ArtifactCommentsSidebar } from "./ArtifactCommentsSidebar";
import {
  type ArtifactLocateRequest,
  ArtifactTextAnnotations,
  type HighlightResolution,
  parseArtifactCommentContext,
} from "./ArtifactTextAnnotations";
import { artifactPreviewBlob } from "./artifactPreviewDocument";
import {
  useArtifactCommentsQuery,
  useCreateArtifactComment,
  useSetArtifactCommentResolved,
} from "./useArtifactComments";

const MARKDOWN_EXTENSIONS = new Set(["md", "mdx", "markdown"]);
const HTML_EXTENSIONS = new Set(["html", "htm"]);

type HtmlPreview = { kind: "html"; html: string };
type PreviewData = string | Blob | HtmlPreview;

function extension(filename: string): string {
  return filename.split(".").pop()?.toLowerCase() ?? "";
}

function ArtifactPreviewError() {
  return (
    <div className="flex h-full items-center justify-center text-muted-foreground">
      This artifact can’t be previewed.
    </div>
  );
}

function CommentsButton({
  count,
  open,
  onClick,
}: {
  count: number;
  open: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      size="sm"
      variant={open ? "primary" : "default"}
      aria-label={open ? "Hide comments" : "Show comments"}
      onClick={onClick}
    >
      <ChatCircle />
      Comments
      {count > 0 && (
        <span className="rounded-full bg-current/10 px-1.5 text-xs">
          {count}
        </span>
      )}
    </Button>
  );
}

function GenericArtifactHeader({
  name,
  commentsAction,
}: {
  name: string;
  commentsAction: ReactNode;
}) {
  return (
    <header className="flex h-11 shrink-0 items-center justify-between border-border border-b px-3">
      <span className="truncate font-[var(--code-font-family)] text-[13px] text-muted-foreground">
        {name}
      </span>
      {commentsAction}
    </header>
  );
}

function ContentAndSidebar({
  children,
  sidebar,
}: {
  children: ReactNode;
  sidebar: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1">
      <div className="min-w-0 flex-1">{children}</div>
      {sidebar}
    </div>
  );
}

export function ArtifactPreview({
  taskId,
  runId,
  artifactId,
  name,
}: {
  taskId: string;
  runId: string;
  artifactId: string;
  name: string;
}) {
  const sessionService = useService<SessionService>(SESSION_SERVICE);
  const [showRendered, setShowRendered] = useState(true);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [pulseThreadId, setPulseThreadId] = useState<string | null>(null);
  const pulseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [locateRequest, setLocateRequest] =
    useState<ArtifactLocateRequest | null>(null);
  const locateNonceRef = useRef(0);
  const [resolutions, setResolutions] = useState(
    new Map<string, HighlightResolution>(),
  );
  const markdownRootRef = useRef<HTMLDivElement>(null);
  const markdownContainerRef = useRef<HTMLDivElement>(null);
  const [imageError, setImageError] = useState(false);
  const [imageCommenting, setImageCommenting] = useState(false);
  const authIdentity = useAuthStateValue(getAuthIdentity);
  const commentsQuery = useArtifactCommentsQuery(artifactId);
  const createComment = useCreateArtifactComment(artifactId);
  const setResolved = useSetArtifactCommentResolved(artifactId);
  const { data, isLoading, isError } = useQuery<PreviewData>({
    queryKey: ["artifactPreview", authIdentity, taskId, runId, artifactId],
    queryFn: async () => {
      const url = await sessionService.getCloudAttachmentPreviewUrl(
        taskId,
        runId,
        artifactId,
      );
      if (!url) throw new Error("Artifact is unavailable");
      const response = await fetch(url);
      if (!response.ok) throw new Error("Artifact preview failed");
      const blob = await response.blob();
      const fileExtension = extension(name);
      if (MARKDOWN_EXTENSIONS.has(fileExtension)) return blob.text();
      if (HTML_EXTENSIONS.has(fileExtension)) {
        return { kind: "html", html: await blob.text() };
      }
      return artifactPreviewBlob(blob, name);
    },
    enabled: authIdentity !== null,
    staleTime: Infinity,
    retry: false,
    meta: AUTH_SCOPED_QUERY_META,
  });
  const previewUrl = useMemo(
    () => (data instanceof Blob ? URL.createObjectURL(data) : null),
    [data],
  );
  const comments = commentsQuery.data ?? [];
  const threadCount = comments.filter(
    (comment) => !comment.source_comment,
  ).length;
  // Uploaded run artifacts are immutable; the artifact UUID is therefore their
  // stable version identifier. Re-uploads receive a new UUID.
  const currentVersion = artifactId;

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useEffect(() => {
    setImageError(false);
    setImageCommenting(false);
  }, []);

  const activateThread = useCallback((id: string, pulse = false) => {
    setSelectedThreadId(id);
    setCommentsOpen(true);
    locateNonceRef.current += 1;
    setLocateRequest({ id, nonce: locateNonceRef.current });
    requestAnimationFrame(() => {
      document
        .querySelector(`[data-comment-thread-id="${CSS.escape(id)}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
    if (!pulse) return;
    if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current);
    setPulseThreadId(id);
    pulseTimerRef.current = setTimeout(() => setPulseThreadId(null), 1_200);
  }, []);

  useEffect(
    () => () => {
      if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current);
    },
    [],
  );

  const contextFor = useCallback(
    (anchor: ArtifactAnchor) => ({
      taskId,
      runId,
      artifactId,
      artifactVersion: currentVersion,
      anchor,
    }),
    [artifactId, currentVersion, runId, taskId],
  );

  const createAnchoredComment = useCallback(
    (anchor: ArtifactAnchor, content: string) => {
      createComment.mutate({ content, context: contextFor(anchor) });
      setCommentsOpen(true);
    },
    [contextFor, createComment],
  );

  const commentsAction = (
    <CommentsButton
      count={threadCount}
      open={commentsOpen}
      onClick={() => setCommentsOpen((open) => !open)}
    />
  );

  const sidebar = commentsOpen ? (
    <ArtifactCommentsSidebar
      comments={comments}
      currentVersion={currentVersion}
      selectedThreadId={selectedThreadId}
      pulseThreadId={pulseThreadId}
      resolutions={resolutions}
      loading={commentsQuery.isLoading}
      busy={createComment.isPending || setResolved.isPending}
      onClose={() => setCommentsOpen(false)}
      onSelectThread={activateThread}
      onCreateDocumentComment={(content) =>
        createAnchoredComment({ kind: "document" }, content)
      }
      onReply={(root: ArtifactComment, content) => {
        const rootContext = parseArtifactCommentContext(root);
        createComment.mutate({
          content,
          sourceCommentId: root.id,
          context: rootContext ?? contextFor({ kind: "document" }),
        });
      }}
      onResolve={(root, resolved) => setResolved.mutate({ root, resolved })}
    />
  ) : null;

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (isError || imageError) return <ArtifactPreviewError />;

  if (typeof data === "string") {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <DocumentPreviewHeader
          label={name}
          content={data}
          showRendered={showRendered}
          onToggleRendered={() => setShowRendered((rendered) => !rendered)}
          actions={commentsAction}
        />
        <ContentAndSidebar sidebar={sidebar}>
          {showRendered ? (
            <div
              ref={markdownContainerRef}
              className="relative h-full overflow-auto"
            >
              <div ref={markdownRootRef}>
                <MarkdownDocumentPreview
                  content={data}
                  components={{ img: () => null }}
                />
              </div>
              <ArtifactTextAnnotations
                artifactName={name}
                rootRef={markdownRootRef}
                containerRef={markdownContainerRef}
                comments={comments}
                activeThreadId={selectedThreadId}
                locateRequest={locateRequest}
                onActivateThread={(id) => activateThread(id, true)}
                onCreate={createAnchoredComment}
                onResolutionsChange={setResolutions}
              />
            </div>
          ) : (
            <div className="h-full overflow-hidden">
              <CodeMirrorEditor content={data} filePath={name} readOnly />
            </div>
          )}
        </ContentAndSidebar>
      </div>
    );
  }

  if (data && !(data instanceof Blob) && data.kind === "html") {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <GenericArtifactHeader name={name} commentsAction={commentsAction} />
        <ContentAndSidebar sidebar={sidebar}>
          <AnnotatedArtifactHtml
            html={data.html}
            name={name}
            comments={comments}
            activeThreadId={selectedThreadId}
            locateRequest={locateRequest}
            onActivateThread={(id) => activateThread(id, true)}
            onCreate={createAnchoredComment}
            onResolutionsChange={setResolutions}
          />
        </ContentAndSidebar>
      </div>
    );
  }

  if (!previewUrl || !data) return <ArtifactPreviewError />;

  if (data instanceof Blob && isAllowedImageMimeType(data.type)) {
    const imageActions = (
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          variant={imageCommenting ? "primary" : "outline"}
          onClick={() => setImageCommenting((commenting) => !commenting)}
        >
          {imageCommenting ? <XIcon /> : <CrosshairSimpleIcon />}
          {imageCommenting ? "Cancel" : "Add comment"}
        </Button>
        {commentsAction}
      </div>
    );
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <GenericArtifactHeader name={name} commentsAction={imageActions} />
        <ContentAndSidebar sidebar={sidebar}>
          <AnnotatedArtifactImage
            src={previewUrl}
            name={name}
            comments={comments}
            activeThreadId={selectedThreadId}
            locateRequest={locateRequest}
            commenting={imageCommenting}
            onCommentingChange={setImageCommenting}
            onActivateThread={(id) => activateThread(id, true)}
            onCreate={createAnchoredComment}
            onError={() => setImageError(true)}
          />
        </ContentAndSidebar>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <GenericArtifactHeader name={name} commentsAction={commentsAction} />
      <ContentAndSidebar sidebar={sidebar}>
        <iframe
          className="h-full w-full border-0 bg-white"
          sandbox=""
          src={previewUrl}
          title={`Preview of ${name}`}
        />
      </ContentAndSidebar>
    </div>
  );
}
