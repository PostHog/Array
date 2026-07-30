import {
  ArrowCounterClockwise,
  ChatCircle,
  CheckCircle,
  WarningCircle,
} from "@phosphor-icons/react";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  Card,
  CardContent,
  Separator,
} from "@posthog/quill";
import { formatRelativeTimeShort } from "@posthog/shared";
import type { UserBasic } from "@posthog/shared/domain-types";
import { MentionText } from "@posthog/ui/features/canvas/components/MentionText";
import type { CommentEntry } from "@posthog/ui/features/canvas/components/taskCommentThreads";
import { MarkdownRenderer } from "@posthog/ui/features/editor/components/MarkdownRenderer";
import { type ReactNode, useState } from "react";
import { CommentComposer } from "./CommentComposer";
import type { HighlightResolution } from "./commentViewTypes";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function CommentBody({ entry }: { entry: CommentEntry }) {
  return (
    <div className="flex gap-2 py-2">
      <Avatar size="sm">
        {entry.avatarUrl && <AvatarImage src={entry.avatarUrl} alt="" />}
        <AvatarFallback>{initials(entry.authorName) || "?"}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate font-medium text-xs">
            {entry.authorName}
          </span>
          <span className="shrink-0 text-muted-foreground text-xs">
            {formatRelativeTimeShort(entry.createdAt)}
          </span>
        </div>
        {entry.format === "markdown" ? (
          <div className="mt-1 break-words text-[13px] leading-relaxed">
            <MarkdownRenderer content={entry.body} />
          </div>
        ) : (
          <MentionText
            content={entry.body}
            className="mt-1 block whitespace-pre-wrap break-words text-[13px] leading-relaxed"
          />
        )}
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
  threadId,
  entries,
  selected,
  pulsing,
  resolved,
  members,
  resolution,
  busy,
  source,
  canReply = true,
  canResolve = true,
  onSelect,
  onReply,
  onResolve,
}: {
  threadId: string;
  /** Root first, then replies. */
  entries: CommentEntry[];
  selected: boolean;
  pulsing: boolean;
  resolved: boolean;
  members: UserBasic[];
  resolution?: HighlightResolution;
  busy: boolean;
  /** Names the resource the thread lives on, for cross-resource lists. */
  source?: ReactNode;
  /** GitHub conversation comments take neither replies nor resolution. */
  canReply?: boolean;
  canResolve?: boolean;
  onSelect: () => void;
  onReply: (content: string, mentions: number[]) => void;
  onResolve: (resolved: boolean) => void;
}) {
  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState("");
  const [root, ...replies] = entries;
  if (!root) return null;

  return (
    <Card
      className={`gap-0 p-0 transition-all duration-300 ${
        selected ? "border-accent bg-accent/5" : ""
      } ${
        // Inset, so a pane that clips its overflow can't shave the highlight.
        pulsing ? "ring-2 ring-accent ring-inset" : ""
      } ${resolved ? "opacity-70" : ""}`}
      data-comment-thread-id={threadId}
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
          <CommentBody entry={root} />
        </button>
        {/* Replies sit at the root's indentation: a thread this narrow reads as
            one conversation, and nesting only stole width from the text. */}
        {replies.map((entry) => (
          <CommentBody key={entry.id} entry={entry} />
        ))}
        {/* A conversation comment can only be read here and acted on in GitHub;
            dead Reply/Resolve buttons would just discard whatever was typed. */}
        {(canReply || canResolve) && <Separator className="my-2" />}
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
            placeholder={
              members.length > 0 ? "Reply… Type @ to mention someone" : "Reply…"
            }
            rows={2}
            disabled={busy}
            submitLabel="Reply"
          />
        ) : (
          (canReply || canResolve) && (
            <div className="flex gap-1">
              {canReply && (
                <Button size="sm" onClick={() => setReplying(true)}>
                  <ChatCircle />
                  Reply
                </Button>
              )}
              {canResolve && (
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => onResolve(!resolved)}
                >
                  {resolved ? <ArrowCounterClockwise /> : <CheckCircle />}
                  {resolved ? "Reopen" : "Resolve"}
                </Button>
              )}
            </div>
          )
        )}
      </CardContent>
    </Card>
  );
}
