import { Button } from "@posthog/quill";
import { useOptionalAuthenticatedClient } from "@posthog/ui/features/auth/authClient";
import { useQuery } from "@tanstack/react-query";
import { Send, Trash2 } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { wasNotebookNodeJustInserted } from "../markdown-notebook/freshlyInserted";
import type {
  NotebookComponentBlockNode,
  NotebookComponentRenderProps,
  NotebookPropValue,
} from "../markdown-notebook/types";

/**
 * One human reply inside a `<Comment ref="…" replies={[…]} />` tag. Replies
 * live in the markdown itself, keyed by `id` so concurrent replies from
 * different people merge instead of clobbering each other (see
 * mergeIdKeyedArrayPropValues in the vendored collaboration.ts). Port of the
 * webapp's NotebookDiscussionComment.
 */
export interface NotebookCommentReply {
  id: string;
  text: string;
  author?: string;
  authorId?: number;
  at?: string;
}

export function getNotebookCommentReplies(
  value: NotebookPropValue | undefined,
): NotebookCommentReply[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry): NotebookCommentReply[] => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return [];
    }
    const { id, text, author, authorId, at } = entry as Record<
      string,
      NotebookPropValue
    >;
    if (typeof id !== "string" || typeof text !== "string") {
      return [];
    }
    return [
      {
        id,
        text,
        author: typeof author === "string" ? author : undefined,
        authorId: typeof authorId === "number" ? authorId : undefined,
        at: typeof at === "string" ? at : undefined,
      },
    ];
  });
}

export function getNotebookDiscussionCommentTitle(
  node: NotebookComponentBlockNode,
): string | null {
  const firstReply = getNotebookCommentReplies(node.props.replies)[0];
  return firstReply ? firstReply.text : "Comment thread";
}

function replyTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const ms = Date.now() - date.getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return date.toLocaleDateString();
}

function AuthorAvatar({ name }: { name?: string }) {
  return (
    <div className="flex size-5 shrink-0 items-center justify-center rounded-full bg-(--gray-5) font-medium text-(--gray-11) text-[10px] uppercase">
      {(name ?? "?").slice(0, 1)}
    </div>
  );
}

/**
 * A Google Docs-style inline comment thread anchored to highlighted text: the
 * thread holds people's replies; the `<ref>` span it points at carries a
 * persistent highlight that lights up while hovering the thread.
 */
export function DiscussionCommentEmbed({
  node,
  mode,
  updateProps,
  deleteNode,
}: NotebookComponentRenderProps) {
  const client = useOptionalAuthenticatedClient();
  const { data: user } = useQuery({
    queryKey: ["current-user"],
    queryFn: () => {
      if (!client) throw new Error("Not authenticated");
      return client.getCurrentUser();
    },
    enabled: client !== null,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const replies = getNotebookCommentReplies(node.props.replies);
  const refId = typeof node.props.ref === "string" ? node.props.ref : null;
  const [draft, setDraft] = useState("");
  const [isHovered, setIsHovered] = useState(false);
  const repliesRef = useRef<HTMLDivElement | null>(null);
  const isEditable = mode === "edit";
  const draftText = draft.trim();

  // Light up the anchored highlight while the cursor is over the thread.
  useEffect(() => {
    if (!refId || !isHovered || typeof document === "undefined") {
      return;
    }
    const highlighted = Array.from(
      document.querySelectorAll(`[data-notebook-ref="${CSS.escape(refId)}"]`),
    );
    for (const element of highlighted) {
      element.classList.add("MarkdownNotebook__ref--active");
    }
    return () => {
      for (const element of highlighted) {
        element.classList.remove("MarkdownNotebook__ref--active");
      }
    };
  }, [refId, isHovered]);

  // The replies list is height-capped; new replies should land in view.
  useEffect(() => {
    const element = repliesRef.current;
    if (element) {
      element.scrollTop = element.scrollHeight;
    }
  }, []);

  const submitReply = (): void => {
    if (!draftText || !isEditable) {
      return;
    }
    const reply: NotebookCommentReply = {
      id: globalThis.crypto.randomUUID(),
      text: draftText,
      author: user?.first_name || user?.email || undefined,
      authorId: typeof user?.id === "number" ? user.id : undefined,
      at: new Date().toISOString(),
    };
    updateProps({
      replies: [...replies, reply] as unknown as NotebookPropValue,
    });
    setDraft("");
  };

  const handleComposerKeyDown = (
    event: KeyboardEvent<HTMLTextAreaElement>,
  ): void => {
    event.stopPropagation();
    if (
      event.key === "Enter" &&
      !event.nativeEvent.isComposing &&
      !event.shiftKey
    ) {
      event.preventDefault();
      submitReply();
    }
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hover only tints the anchored <ref> highlight — decorative, keyboard access unaffected
    <div
      className="MarkdownNotebook__discussion-comment"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      data-attr="notebook-discussion-comment"
    >
      <div
        className="MarkdownNotebook__discussion-comment-replies"
        ref={repliesRef}
      >
        {replies.map((reply) => (
          <div
            key={reply.id}
            className="MarkdownNotebook__discussion-comment-reply"
          >
            <AuthorAvatar name={reply.author} />
            <div className="MarkdownNotebook__discussion-comment-reply-body">
              <div className="MarkdownNotebook__discussion-comment-reply-meta">
                <span className="MarkdownNotebook__discussion-comment-reply-author">
                  {reply.author ?? "Someone"}
                </span>
                {reply.at ? (
                  <span className="MarkdownNotebook__discussion-comment-reply-time">
                    {replyTime(reply.at)}
                  </span>
                ) : null}
              </div>
              <div className="MarkdownNotebook__discussion-comment-reply-text">
                {reply.text}
              </div>
            </div>
          </div>
        ))}
        {!replies.length && !isEditable ? (
          <div className="MarkdownNotebook__discussion-comment-empty">
            No replies yet
          </div>
        ) : null}
      </div>
      {isEditable ? (
        <div className="MarkdownNotebook__discussion-comment-composer">
          <div className="input-like flex flex-col rounded">
            <textarea
              className="MarkdownNotebook__discussion-comment-input w-full rounded"
              value={draft}
              onChange={(event) => {
                event.stopPropagation();
                setDraft(event.currentTarget.value);
              }}
              onKeyDown={handleComposerKeyDown}
              placeholder={replies.length ? "Reply..." : "Comment..."}
              rows={1}
              // biome-ignore lint/a11y/noAutofocus: focusing the composer of a just-inserted thread is the expected flow (mirrors upstream)
              autoFocus={wasNotebookNodeJustInserted(node.id)}
              data-attr="notebook-discussion-comment-input"
            />
          </div>
          <div className="MarkdownNotebook__discussion-comment-actions">
            <Button
              variant="outline"
              size="icon-xs"
              aria-label="Delete thread"
              onClick={deleteNode}
            >
              <Trash2 size="1em" />
            </Button>
            <Button
              variant="primary"
              size="icon-xs"
              aria-label="Send reply"
              disabled={!draftText}
              onClick={submitReply}
            >
              <Send size="1em" />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
