import {
  ChatCircleIcon,
  LinkBreakIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import type {
  CanvasComment,
  CanvasCommentThread,
} from "@posthog/core/canvas/canvasCommentsSchemas";
import { formatRelativeTimeShort } from "@posthog/shared";
import {
  Badge,
  Button,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Textarea,
} from "@posthog/quill";
import { useOptionalAuthenticatedClient } from "@posthog/ui/features/auth/authClient";
import { useCurrentUser } from "@posthog/ui/features/auth/useCurrentUser";
import {
  useAddCanvasComment,
  useAddCanvasReply,
  useCanvasComments,
  useRemoveCanvasComment,
} from "@posthog/ui/features/canvas/hooks/useCanvasComments";
import { useCanvasCommentsStore } from "@posthog/ui/features/canvas/stores/canvasCommentsStore";
import { Flex, ScrollArea, Text } from "@radix-ui/themes";
import { useState } from "react";

// The side panel's Comments tab: every thread on the canvas, numbered to
// match the on-document pins. Clicking a thread emphasizes + scrolls to its
// anchor; anchors that no longer resolve get an "original context missing"
// badge instead. Content renders as plain text only — comments are
// user-authored and never interpreted as markup.
export function CanvasCommentsPanel({
  dashboardId,
  canvasVersionId,
}: {
  dashboardId: string;
  canvasVersionId?: string;
}) {
  const { threads, isLoading } = useCanvasComments(dashboardId);
  const { addComment, isAdding } = useAddCanvasComment(dashboardId);
  const client = useOptionalAuthenticatedClient();
  const { data: currentUser } = useCurrentUser({ client });

  const [pageComposerOpen, setPageComposerOpen] = useState(false);
  const [pageContent, setPageContent] = useState("");

  const submitPageComment = async () => {
    const content = pageContent.trim();
    if (!content) return;
    await addComment({ content, anchor: { type: "page" }, canvasVersionId });
    setPageContent("");
    setPageComposerOpen(false);
  };

  return (
    <Flex direction="column" className="h-full min-h-0">
      <Flex direction="column" gap="2" className="shrink-0 border-b p-3">
        {pageComposerOpen ? (
          <>
            <Textarea
              autoFocus
              rows={3}
              placeholder="Comment on this document…"
              value={pageContent}
              onChange={(e) => setPageContent(e.target.value)}
            />
            <Flex justify="end" gap="2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPageComposerOpen(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                variant="primary"
                disabled={!pageContent.trim() || isAdding}
                onClick={() => void submitPageComment()}
              >
                Comment
              </Button>
            </Flex>
          </>
        ) : (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setPageComposerOpen(true)}
          >
            <ChatCircleIcon size={14} />
            Comment on page
          </Button>
        )}
        <Text size="1" className="text-gray-9">
          Select text or pick an element in the document to comment on it.
        </Text>
      </Flex>
      <ScrollArea className="min-h-0 flex-1">
        {threads.length === 0 ? (
          <Empty className="h-full border-0">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ChatCircleIcon size={24} />
              </EmptyMedia>
              <EmptyTitle>No comments yet</EmptyTitle>
              <EmptyDescription>
                {isLoading
                  ? "Loading comments…"
                  : "Select text or an element in the document to start a thread."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Flex direction="column" className="p-2">
            {threads.map((thread) => (
              <CommentThread
                key={thread.root.id}
                thread={thread}
                dashboardId={dashboardId}
                currentUserUuid={currentUser?.uuid}
              />
            ))}
          </Flex>
        )}
      </ScrollArea>
    </Flex>
  );
}

// Where the thread anchors, for the panel row: the quoted text, the element
// label, or "Page".
function anchorSummary(root: CanvasComment): string {
  const anchor = root.anchor;
  if (anchor?.type === "text") {
    const quote =
      anchor.quote.length > 80 ? `${anchor.quote.slice(0, 80)}…` : anchor.quote;
    return `“${quote}”`;
  }
  if (anchor?.type === "element") return anchor.label || anchor.selector;
  return "Page";
}

function CommentThread({
  thread,
  dashboardId,
  currentUserUuid,
}: {
  thread: CanvasCommentThread;
  dashboardId: string;
  currentUserUuid?: string;
}) {
  const activeCommentId = useCanvasCommentsStore((s) => s.activeCommentId);
  const setActiveCommentId = useCanvasCommentsStore(
    (s) => s.setActiveCommentId,
  );
  const resolved = useCanvasCommentsStore((s) => s.resolved);
  const { addReply, isReplying } = useAddCanvasReply(dashboardId);
  const { removeComment } = useRemoveCanvasComment(dashboardId);

  const [replyOpen, setReplyOpen] = useState(false);
  const [replyContent, setReplyContent] = useState("");

  const root = thread.root;
  const isActive = activeCommentId === root.id;
  const anchoredInDoc = root.anchor && root.anchor.type !== "page";
  const orphaned = anchoredInDoc && resolved[root.id] === false;

  const submitReply = async () => {
    const content = replyContent.trim();
    if (!content) return;
    await addReply({ content, rootId: root.id });
    setReplyContent("");
    setReplyOpen(false);
  };

  return (
    <Flex
      direction="column"
      gap="1"
      className={`cursor-pointer rounded-lg border p-2.5 transition-colors ${
        isActive
          ? "border-accent-7 bg-accent-2"
          : "border-transparent hover:bg-gray-2"
      }`}
      onClick={() => setActiveCommentId(isActive ? null : root.id)}
    >
      <Flex align="center" gap="2">
        <span className="flex size-[18px] shrink-0 items-center justify-center rounded-full bg-indigo-9 font-bold text-[10px] text-white">
          {thread.index}
        </span>
        <Text size="1" className="truncate text-gray-9">
          {anchorSummary(root)}
        </Text>
        {orphaned && (
          <Badge variant="warning">
            <LinkBreakIcon size={11} />
            Context missing
          </Badge>
        )}
      </Flex>
      <CommentBody
        comment={root}
        canDelete={!!currentUserUuid && root.createdBy.uuid === currentUserUuid}
        onDelete={() => void removeComment(root.id)}
      />
      {thread.replies.map((reply) => (
        <div key={reply.id} className="border-gray-4 border-l-2 pl-2">
          <CommentBody
            comment={reply}
            canDelete={
              !!currentUserUuid && reply.createdBy.uuid === currentUserUuid
            }
            onDelete={() => void removeComment(reply.id)}
          />
        </div>
      ))}
      {replyOpen ? (
        <Flex direction="column" gap="1" onClick={(e) => e.stopPropagation()}>
          <Textarea
            autoFocus
            rows={2}
            placeholder="Reply…"
            value={replyContent}
            onChange={(e) => setReplyContent(e.target.value)}
          />
          <Flex justify="end" gap="2">
            <Button
              size="xs"
              variant="outline"
              onClick={() => setReplyOpen(false)}
            >
              Cancel
            </Button>
            <Button
              size="xs"
              variant="primary"
              disabled={!replyContent.trim() || isReplying}
              onClick={() => void submitReply()}
            >
              Reply
            </Button>
          </Flex>
        </Flex>
      ) : (
        <button
          type="button"
          className="self-start text-[11px] text-gray-9 hover:text-gray-12"
          onClick={(e) => {
            e.stopPropagation();
            setReplyOpen(true);
          }}
        >
          Reply
        </button>
      )}
    </Flex>
  );
}

function CommentBody({
  comment,
  canDelete,
  onDelete,
}: {
  comment: CanvasComment;
  canDelete: boolean;
  onDelete: () => void;
}) {
  return (
    <Flex direction="column" gap="1" className="group/comment">
      <Flex align="center" gap="2">
        <Text size="1" weight="medium" className="truncate text-gray-12">
          {comment.createdBy.name}
        </Text>
        <Text size="1" className="shrink-0 text-gray-9">
          {formatRelativeTimeShort(comment.createdAt)}
        </Text>
        {canDelete && (
          <button
            type="button"
            aria-label="Delete comment"
            className="ml-auto text-gray-8 opacity-0 transition-opacity hover:text-red-11 group-hover/comment:opacity-100"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          >
            <TrashIcon size={13} />
          </button>
        )}
      </Flex>
      {/* Plain text on purpose — never rendered as markdown/HTML. */}
      <Text size="2" className="whitespace-pre-wrap break-words text-gray-12">
        {comment.content}
      </Text>
    </Flex>
  );
}
