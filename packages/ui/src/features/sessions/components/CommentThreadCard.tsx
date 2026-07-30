import {
  ArrowCounterClockwise,
  ChatCircle,
  CheckCircle,
  WarningCircle,
} from "@phosphor-icons/react";
import type { ResourceComment } from "@posthog/api-client/posthog-client";
import {
  Avatar,
  AvatarFallback,
  Button,
  Card,
  CardContent,
  Separator,
} from "@posthog/quill";
import { formatRelativeTimeShort } from "@posthog/shared";
import type { UserBasic } from "@posthog/shared/domain-types";
import { MentionText } from "@posthog/ui/features/canvas/components/MentionText";
import { type ReactNode, useState } from "react";
import { CommentComposer } from "./CommentComposer";
import {
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

/**
 * One thread, with its replies and the reply/resolve controls. Selecting it is
 * the caller's business: in a list spanning several resources that means
 * opening the resource and locating the anchor.
 */
export function CommentThreadCard({
  root,
  replies,
  selected,
  pulsing,
  resolved,
  members,
  resolution,
  busy,
  source,
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
  /** Names the resource the thread lives on, for cross-resource lists. */
  source?: ReactNode;
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
          {source}
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
