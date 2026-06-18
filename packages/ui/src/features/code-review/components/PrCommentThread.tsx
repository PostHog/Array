import {
  ArrowCounterClockwise,
  CaretDown,
  CaretUp,
  ChatCircle,
  CheckCircle,
  File,
  Robot,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import {
  buildAskAboutPrCommentPrompt,
  buildFixPrCommentPrompt,
} from "@posthog/core/code-review/reviewPrompts";
import { Button } from "@posthog/quill";
import type { PrReviewComment } from "@posthog/shared";
import { formatRelativeTimeShort } from "@posthog/shared";
import { Avatar, Badge, Box, Flex, Text } from "@radix-ui/themes";
import { useCallback, useEffect, useRef, useState } from "react";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import type { PluggableList } from "unified";
import { isSendMessageSubmitKey } from "../../../utils/sendMessageKey";
import { MarkdownRenderer } from "../../editor/components/MarkdownRenderer";
import { sendPromptToAgent } from "../../sessions/sendPromptToAgent";
import { usePrCommentActions } from "../hooks/usePrCommentActions";
import type { PrCommentMetadata } from "../types";

const ghRehypePlugins: PluggableList = [
  rehypeRaw,
  [rehypeSanitize, defaultSchema],
];

const MAX_COMMENT_HEIGHT = 120;

interface ThreadActionBarProps {
  prUrl: string | null;
  taskId: string;
  filePath: string;
  endLine: number;
  side: "old" | "new";
  comments: PrReviewComment[];
  isResolved: boolean;
  onResolveToggle: () => void;
  showReplyBox: boolean;
  pendingReply: string | null;
  onShowReplyBox: () => void;
  onHideReplyBox: () => void;
  onSubmitReply: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  textareaRefCallback: (el: HTMLTextAreaElement | null) => void;
}

function ThreadActionBar({
  prUrl,
  taskId,
  filePath,
  endLine,
  side,
  comments,
  isResolved,
  onResolveToggle,
  showReplyBox,
  pendingReply,
  onShowReplyBox,
  onHideReplyBox,
  onSubmitReply,
  onKeyDown,
  textareaRefCallback,
}: ThreadActionBarProps) {
  if (showReplyBox) {
    return (
      <div className="mt-1.5 border-[var(--gray-4)] border-t pt-1.5">
        <textarea
          ref={textareaRefCallback}
          placeholder="Write a reply..."
          onKeyDown={onKeyDown}
          className="min-h-[48px] w-full resize-none rounded border border-[var(--gray-6)] bg-[var(--color-background)] p-1.5 text-[13px] text-[var(--gray-12)] leading-normal outline-none"
        />
        <Flex align="center" gap="2" className="mt-1.5">
          <Button
            variant="primary"
            size="sm"
            onClick={onSubmitReply}
            disabled={!!pendingReply}
          >
            <ChatCircle />
            {pendingReply ? "Sending..." : "Reply"}
          </Button>
          <Button size="icon-sm" onClick={onHideReplyBox}>
            <X />
          </Button>
        </Flex>
      </div>
    );
  }

  return (
    <Flex
      align="center"
      gap="1"
      className="mt-1 border-[var(--gray-4)] border-t pt-1.5"
    >
      {prUrl && (
        <Button size="sm" onClick={onShowReplyBox}>
          <ChatCircle />
          Reply
        </Button>
      )}

      {prUrl && (
        <Button size="sm" onClick={onResolveToggle}>
          {isResolved ? (
            <>
              <ArrowCounterClockwise />
              Unresolve
            </>
          ) : (
            <>
              <CheckCircle />
              Resolve
            </>
          )}
        </Button>
      )}

      <Button
        size="sm"
        onClick={() =>
          sendPromptToAgent(
            taskId,
            buildFixPrCommentPrompt(filePath, endLine, side, comments),
          )
        }
      >
        <Robot />
        Fix
      </Button>

      <Button
        size="sm"
        onClick={() =>
          sendPromptToAgent(
            taskId,
            buildAskAboutPrCommentPrompt(filePath, endLine, side, comments),
          )
        }
      >
        <Robot />
        Ask
      </Button>
    </Flex>
  );
}

interface PrCommentThreadProps {
  taskId: string;
  prUrl: string | null;
  filePath: string;
  metadata: PrCommentMetadata;
}

function CommentBody({
  comment,
  showLineAbove = false,
  showLineBelow = false,
}: {
  comment: PrReviewComment;
  showLineAbove?: boolean;
  showLineBelow?: boolean;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    const el = contentRef.current;
    if (el) {
      setIsOverflowing(el.scrollHeight > MAX_COMMENT_HEIGHT);
    }
  }, []);

  return (
    <div className="flex gap-2">
      <div className="flex flex-col items-center">
        {showLineAbove ? (
          <div className="h-1.5 w-0.5 rounded-full bg-[var(--gray-5)]" />
        ) : (
          <div className="h-1.5" />
        )}
        <Avatar
          size="1"
          radius="full"
          src={comment.user.avatar_url}
          fallback={comment.user.login[0]?.toUpperCase() ?? "?"}
          className="shrink-0"
        />
        {showLineBelow && (
          <div className="w-0.5 flex-1 rounded-full bg-[var(--gray-5)]" />
        )}
      </div>
      <div className="min-w-0 flex-1 pt-1.5 pb-1.5">
        <Flex align="center" gap="2" className="mb-0.5">
          <Text className="font-medium text-[13px] text-[var(--gray-12)]">
            {comment.user.login}
          </Text>
          <Text className="text-[13px] text-[var(--gray-9)]">
            {formatRelativeTimeShort(comment.created_at)}
          </Text>
        </Flex>
        <Box
          ref={contentRef}
          className="relative overflow-hidden break-words text-[13px] text-[var(--gray-11)] leading-relaxed [&_code]:break-all [&_img]:max-w-full [&_p]:m-0 [&_pre]:max-w-full [&_pre]:overflow-x-auto"
          style={{
            maxHeight:
              isExpanded || !isOverflowing
                ? undefined
                : `${MAX_COMMENT_HEIGHT}px`,
            overflowWrap: "break-word",
          }}
        >
          <MarkdownRenderer
            content={comment.body}
            rehypePlugins={ghRehypePlugins}
          />
          {!isExpanded && isOverflowing && (
            <Box
              className="pointer-events-none absolute inset-x-0 bottom-0 h-12"
              style={{
                background: "linear-gradient(transparent, var(--gray-2))",
              }}
            />
          )}
        </Box>
        {isOverflowing && (
          <Button
            size="sm"
            onClick={() => setIsExpanded((prev) => !prev)}
            className="mt-1"
          >
            {isExpanded ? (
              <>
                <CaretUp />
                Show less
              </>
            ) : (
              <>
                <CaretDown />
                Show more
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}

export function PrCommentThread({
  taskId,
  prUrl,
  filePath,
  metadata,
}: PrCommentThreadProps) {
  const {
    threadId,
    nodeId,
    isResolved: initialIsResolved,
    comments,
    isOutdated,
    isFileLevel,
    endLine,
    side: annotationSide,
  } = metadata;
  const side = annotationSide === "deletions" ? "old" : "new";
  const { reply, resolve } = usePrCommentActions(prUrl);
  const [showReplyBox, setShowReplyBox] = useState(false);
  const [pendingReply, setPendingReply] = useState<string | null>(null);
  const [isResolved, setIsResolved] = useState(initialIsResolved);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setIsResolved(initialIsResolved);
  }, [initialIsResolved]);

  // Clear pending reply once the real comments list includes it
  const lastCommentId = comments[comments.length - 1]?.id;
  const prevLastCommentIdRef = useRef(lastCommentId);
  useEffect(() => {
    if (lastCommentId !== prevLastCommentIdRef.current && pendingReply) {
      setPendingReply(null);
    }
    prevLastCommentIdRef.current = lastCommentId;
  }, [lastCommentId, pendingReply]);

  const handleReplySubmit = useCallback(async () => {
    const text = textareaRef.current?.value?.trim();
    if (text) {
      setPendingReply(text);
      setShowReplyBox(false);
      const success = await reply(threadId, text);
      if (!success) {
        setPendingReply(null);
      }
    }
  }, [reply, threadId]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (isSendMessageSubmitKey(e)) {
        e.preventDefault();
        handleReplySubmit();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setShowReplyBox(false);
      }
    },
    [handleReplySubmit],
  );

  const setTextareaRefCallback = useCallback(
    (el: HTMLTextAreaElement | null) => {
      textareaRef.current = el;
      if (el) {
        requestAnimationFrame(() => el.focus());
      }
    },
    [],
  );

  const handleResolveToggle = useCallback(async () => {
    const next = !isResolved;
    setIsResolved(next);
    const success = await resolve(nodeId, next);
    if (!success) setIsResolved(!next);
  }, [isResolved, nodeId, resolve]);

  return (
    <div className="px-3 py-1.5" style={{ contain: "inline-size" }}>
      <div
        data-pr-comment-thread=""
        className={`overflow-hidden whitespace-normal rounded-md border border-[var(--gray-5)] bg-[var(--gray-2)] px-2.5 py-2 font-sans ${isResolved ? "opacity-60" : ""}`}
      >
        {(isResolved || isOutdated || isFileLevel) && (
          <Flex align="center" gap="1" className="mb-1.5">
            {isResolved && (
              <Badge color="green" size="1" variant="soft">
                <CheckCircle size={12} weight="fill" />
                Resolved
              </Badge>
            )}
            {isFileLevel && (
              <Badge color="gray" size="1" variant="soft">
                <File size={12} />
                File comment
              </Badge>
            )}
            {isOutdated && (
              <Badge color="yellow" size="1" variant="soft">
                <WarningCircle size={12} weight="fill" />
                Outdated
              </Badge>
            )}
          </Flex>
        )}

        {comments.map((comment, index) => (
          <CommentBody
            key={comment.id}
            comment={comment}
            showLineAbove={index > 0}
            showLineBelow={index < comments.length - 1 || !!pendingReply}
          />
        ))}

        {pendingReply && (
          <div className="flex gap-2 opacity-50">
            <div className="flex flex-col items-center">
              <div className="h-1.5 w-0.5 rounded-full bg-[var(--gray-5)]" />
              <Avatar size="1" radius="full" fallback="" className="shrink-0" />
            </div>
            <div className="min-w-0 flex-1 pt-1.5 pb-1.5">
              <Flex align="center" gap="2" className="mb-0.5">
                <Text className="font-medium text-[13px] text-[var(--gray-12)]">
                  Sending...
                </Text>
              </Flex>
              <div className="text-[13px] text-[var(--gray-11)] leading-relaxed">
                <MarkdownRenderer
                  content={pendingReply}
                  rehypePlugins={ghRehypePlugins}
                />
              </div>
            </div>
          </div>
        )}

        <ThreadActionBar
          prUrl={prUrl}
          taskId={taskId}
          filePath={filePath}
          endLine={endLine}
          side={side}
          comments={comments}
          isResolved={isResolved}
          onResolveToggle={handleResolveToggle}
          showReplyBox={showReplyBox}
          pendingReply={pendingReply}
          onShowReplyBox={() => setShowReplyBox(true)}
          onHideReplyBox={() => setShowReplyBox(false)}
          onSubmitReply={handleReplySubmit}
          onKeyDown={handleKeyDown}
          textareaRefCallback={setTextareaRefCallback}
        />
      </div>
    </div>
  );
}
