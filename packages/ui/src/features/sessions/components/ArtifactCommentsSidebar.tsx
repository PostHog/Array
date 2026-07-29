import {
  ArrowCounterClockwise,
  ChatCircle,
  CheckCircle,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import type { ArtifactComment } from "@posthog/api-client/posthog-client";
import {
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  Card,
  CardContent,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Separator,
  Spinner,
  Textarea,
} from "@posthog/quill";
import { formatRelativeTimeShort } from "@posthog/shared";
import { useMemo, useState } from "react";
import {
  type HighlightResolution,
  parseArtifactCommentContext,
} from "./ArtifactTextAnnotations";

function authorName(comment: ArtifactComment): string {
  const user = comment.created_by;
  if (!user) return "You";
  return (
    [user.first_name, user.last_name].filter(Boolean).join(" ") || user.email
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function CommentBody({ comment }: { comment: ArtifactComment }) {
  const name = authorName(comment);
  return (
    <div className="flex gap-2 py-2">
      <Avatar size="sm">
        <AvatarFallback>{initials(name) || "?"}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate font-medium text-xs">{name}</span>
          <span className="shrink-0 text-muted-foreground text-xs">
            {formatRelativeTimeShort(comment.created_at)}
          </span>
        </div>
        <p className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-relaxed">
          {comment.content}
        </p>
      </div>
    </div>
  );
}

function Thread({
  root,
  replies,
  selected,
  currentVersion,
  resolution,
  busy,
  onSelect,
  onReply,
  onResolve,
}: {
  root: ArtifactComment;
  replies: ArtifactComment[];
  selected: boolean;
  currentVersion: string;
  resolution?: HighlightResolution;
  busy: boolean;
  onSelect: () => void;
  onReply: (content: string) => void;
  onResolve: (resolved: boolean) => void;
}) {
  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState("");
  const resolved = !!root.completed_at;
  const context = parseArtifactCommentContext(root);
  const anotherVersion =
    context?.artifactVersion && context.artifactVersion !== currentVersion;

  return (
    <Card
      className={`gap-0 p-0 transition-colors ${
        selected ? "border-accent bg-accent/5" : ""
      } ${resolved ? "opacity-70" : ""}`}
      data-comment-thread-id={root.id}
    >
      <CardContent className="p-3">
        <button type="button" className="w-full text-left" onClick={onSelect}>
          {(resolution === "orphaned" || anotherVersion) && (
            <div className="mb-1.5 flex items-center gap-1 text-amber-700 text-xs dark:text-amber-300">
              <WarningCircle />
              {resolution === "orphaned"
                ? "The highlighted text changed"
                : "Re-anchored from another artifact version"}
            </div>
          )}
          <CommentBody comment={root} />
        </button>
        {replies.length > 0 && (
          <div className="ml-3 border-border border-l pl-3">
            {replies.map((comment) => (
              <CommentBody key={comment.id} comment={comment} />
            ))}
          </div>
        )}
        <Separator className="my-2" />
        {replying ? (
          <div className="space-y-2">
            <Textarea
              autoFocus
              value={reply}
              placeholder="Write a reply..."
              onChange={(event) => setReply(event.currentTarget.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  if (reply.trim()) onReply(reply.trim());
                  setReply("");
                  setReplying(false);
                }
              }}
            />
            <div className="flex gap-2">
              <Button
                variant="primary"
                size="sm"
                disabled={!reply.trim() || busy}
                onClick={() => {
                  onReply(reply.trim());
                  setReply("");
                  setReplying(false);
                }}
              >
                Reply
              </Button>
              <Button size="sm" onClick={() => setReplying(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex gap-1">
            <Button size="sm" onClick={() => setReplying(true)}>
              <ChatCircle />
              Reply
            </Button>
            <Button
              size="sm"
              disabled={busy}
              onClick={() => onResolve(!resolved)}
            >
              {resolved ? <ArrowCounterClockwise /> : <CheckCircle />}
              {resolved ? "Reopen" : "Resolve"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function ArtifactCommentsSidebar({
  comments,
  currentVersion,
  selectedThreadId,
  resolutions,
  loading,
  busy,
  onClose,
  onSelectThread,
  onCreateDocumentComment,
  onReply,
  onResolve,
}: {
  comments: ArtifactComment[];
  currentVersion: string;
  selectedThreadId: string | null;
  resolutions: Map<string, HighlightResolution>;
  loading: boolean;
  busy: boolean;
  onClose: () => void;
  onSelectThread: (id: string) => void;
  onCreateDocumentComment: (content: string) => void;
  onReply: (root: ArtifactComment, content: string) => void;
  onResolve: (root: ArtifactComment, resolved: boolean) => void;
}) {
  const [draft, setDraft] = useState("");
  const { roots, repliesByRoot } = useMemo(() => {
    const roots = comments
      .filter((comment) => !comment.source_comment)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    const repliesByRoot = new Map<string, ArtifactComment[]>();
    for (const comment of comments) {
      if (!comment.source_comment) continue;
      const existing = repliesByRoot.get(comment.source_comment) ?? [];
      existing.push(comment);
      repliesByRoot.set(comment.source_comment, existing);
    }
    return { roots, repliesByRoot };
  }, [comments]);

  return (
    <aside className="flex h-full w-[360px] shrink-0 flex-col border-border border-l bg-muted/30">
      <header className="flex h-11 shrink-0 items-center justify-between border-border border-b px-3">
        <div className="flex items-center gap-2 font-medium text-sm">
          Comments
          {comments.length > 0 && <Badge>{roots.length}</Badge>}
        </div>
        <Button
          size="icon-sm"
          variant="default"
          aria-label="Close comments"
          onClick={onClose}
        >
          <X />
        </Button>
      </header>
      <div className="flex-1 space-y-2 overflow-auto p-3">
        {loading ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : roots.length === 0 ? (
          <Empty className="py-8">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ChatCircle />
              </EmptyMedia>
              <EmptyTitle>No comments yet</EmptyTitle>
              <EmptyDescription>
                Select text to comment inline, or comment on the whole artifact
                below.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          roots.map((root) => (
            <Thread
              key={root.id}
              root={root}
              replies={repliesByRoot.get(root.id) ?? []}
              selected={root.id === selectedThreadId}
              currentVersion={currentVersion}
              resolution={resolutions.get(root.id)}
              busy={busy}
              onSelect={() => onSelectThread(root.id)}
              onReply={(content) => onReply(root, content)}
              onResolve={(resolved) => onResolve(root, resolved)}
            />
          ))
        )}
      </div>
      <footer className="shrink-0 border-border border-t bg-background p-3">
        <Textarea
          value={draft}
          placeholder="Comment on this artifact..."
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              if (draft.trim()) onCreateDocumentComment(draft.trim());
              setDraft("");
            }
          }}
        />
        <div className="mt-2 flex justify-end">
          <Button
            size="sm"
            variant="primary"
            disabled={!draft.trim() || busy}
            onClick={() => {
              onCreateDocumentComment(draft.trim());
              setDraft("");
            }}
          >
            Comment
          </Button>
        </div>
      </footer>
    </aside>
  );
}
