import {
  ArrowCounterClockwise,
  CaretDownIcon,
  ChatCircle,
  CheckCircle,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import type { ResourceComment } from "@posthog/api-client/posthog-client";
import {
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  Card,
  CardContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Separator,
  Spinner,
} from "@posthog/quill";
import { formatRelativeTimeShort } from "@posthog/shared";
import type { UserBasic } from "@posthog/shared/domain-types";
import { MentionText } from "@posthog/ui/features/canvas/components/MentionText";
import { useState } from "react";
import { CommentComposer } from "./CommentComposer";
import {
  type CommentThread,
  type HighlightResolution,
  readCommentContext,
} from "./commentViewTypes";

function authorName(comment: ResourceComment): string {
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

function CommentBody({ comment }: { comment: ResourceComment }) {
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
        <MentionText
          content={comment.content ?? ""}
          className="mt-1 block whitespace-pre-wrap break-words text-[13px] leading-relaxed"
        />
      </div>
    </div>
  );
}

function Thread({
  root,
  replies,
  selected,
  pulsing,
  resolved,
  members,
  resolution,
  busy,
  onSelect,
  onReply,
  onResolve,
}: {
  root: ResourceComment;
  replies: ResourceComment[];
  selected: boolean;
  pulsing: boolean;
  resolved: boolean;
  members: UserBasic[];
  resolution?: HighlightResolution;
  busy: boolean;
  onSelect: () => void;
  onReply: (content: string, mentions: number[]) => void;
  onResolve: (resolved: boolean) => void;
}) {
  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState("");
  const visibleReplies = replies.filter(
    (comment) => !readCommentContext(comment)?.threadState,
  );

  return (
    <Card
      className={`gap-0 p-0 transition-all duration-300 ${
        selected ? "border-accent bg-accent/5" : ""
      } ${pulsing ? "ring-2 ring-accent ring-offset-2 ring-offset-background" : ""} ${resolved ? "opacity-70" : ""}`}
      data-comment-thread-id={root.id}
    >
      <CardContent className="p-3">
        <button type="button" className="w-full text-left" onClick={onSelect}>
          {resolution === "orphaned" && (
            <div className="mb-1.5 flex items-center gap-1 text-amber-700 text-xs dark:text-amber-300">
              <WarningCircle />
              The highlighted text changed
            </div>
          )}
          <CommentBody comment={root} />
        </button>
        {visibleReplies.length > 0 && (
          <div className="ml-3 border-border border-l pl-3">
            {visibleReplies.map((comment) => (
              <CommentBody key={comment.id} comment={comment} />
            ))}
          </div>
        )}
        <Separator className="my-2" />
        {replying ? (
          <CommentComposer
            value={reply}
            onValueChange={setReply}
            onSubmit={(content, mentions) => {
              onReply(content, mentions);
              setReply("");
              setReplying(false);
            }}
            onCancel={() => setReplying(false)}
            members={members}
            placeholder="Reply… Type @ to mention someone"
            rows={2}
            disabled={busy}
            submitLabel="Reply"
          />
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

export function CommentsSidebar({
  threads,
  members,
  selectedThreadId,
  pulseThreadId,
  resolutions,
  loading,
  busy,
  onClose,
  onSelectThread,
  onCreateDocumentComment,
  onReply,
  onResolve,
}: {
  /** Built by the caller so the sidebar and the artifact renderers share one
   *  thread model (and so a caller can pass threads from several resources). */
  threads: CommentThread[];
  members: UserBasic[];
  selectedThreadId: string | null;
  pulseThreadId: string | null;
  resolutions: Map<string, HighlightResolution>;
  loading: boolean;
  busy: boolean;
  onClose: () => void;
  onSelectThread: (id: string) => void;
  onCreateDocumentComment: (content: string, mentions: number[]) => void;
  onReply: (root: ResourceComment, content: string, mentions: number[]) => void;
  onResolve: (root: ResourceComment, resolved: boolean) => void;
}) {
  const [draft, setDraft] = useState("");
  const [filter, setFilter] = useState<"open" | "resolved">("open");
  const openCount = threads.filter((thread) => !thread.resolved).length;
  const resolvedCount = threads.length - openCount;
  const visibleThreads = threads.filter(
    (thread) => thread.resolved === (filter === "resolved"),
  );

  return (
    <aside className="flex h-full w-[360px] shrink-0 flex-col border-border border-l bg-muted/30">
      <header className="flex h-11 shrink-0 items-center justify-between border-border border-b px-3">
        <div className="flex items-center gap-2 font-medium text-sm">
          Comments
          {threads.length > 0 && <Badge>{visibleThreads.length}</Badge>}
        </div>
        <div className="flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button size="sm" aria-label="Filter comments">
                  {filter === "open" ? "Open" : "Resolved"}
                  <CaretDownIcon />
                </Button>
              }
            />
            <DropdownMenuContent align="end" sideOffset={6}>
              <DropdownMenuRadioGroup
                value={filter}
                onValueChange={(value) =>
                  setFilter(value as "open" | "resolved")
                }
              >
                <DropdownMenuRadioItem value="open">
                  Open ({openCount})
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="resolved">
                  Resolved ({resolvedCount})
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            size="icon-sm"
            variant="default"
            aria-label="Close comments"
            onClick={onClose}
          >
            <X />
          </Button>
        </div>
      </header>
      <div className="flex-1 space-y-2 overflow-auto p-3">
        {loading ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : visibleThreads.length === 0 ? (
          <Empty className="py-8">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ChatCircle />
              </EmptyMedia>
              <EmptyTitle>
                No {filter === "open" ? "open" : "resolved"} comments
              </EmptyTitle>
              <EmptyDescription>
                {filter === "open"
                  ? "Select text to comment inline, or comment on the whole artifact below."
                  : "Resolved threads will appear here."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          visibleThreads.map(({ root, replies, resolved }) => (
            <Thread
              key={root.id}
              root={root}
              replies={replies}
              selected={root.id === selectedThreadId}
              pulsing={root.id === pulseThreadId}
              resolved={resolved}
              members={members}
              resolution={resolutions.get(root.id)}
              busy={busy}
              onSelect={() => onSelectThread(root.id)}
              onReply={(content, mentions) => onReply(root, content, mentions)}
              onResolve={(resolved) => onResolve(root, resolved)}
            />
          ))
        )}
      </div>
      <footer className="shrink-0 border-border border-t bg-background p-3">
        <CommentComposer
          value={draft}
          onValueChange={setDraft}
          onSubmit={(content, mentions) => {
            onCreateDocumentComment(content, mentions);
            setDraft("");
          }}
          members={members}
          placeholder="Comment… Type @ to mention someone"
          rows={3}
          disabled={busy}
        />
      </footer>
    </aside>
  );
}
