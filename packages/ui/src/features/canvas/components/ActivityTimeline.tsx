import { CheckCircleIcon, XCircleIcon } from "@phosphor-icons/react";
import type { ThreadTimelineRow } from "@posthog/core/canvas/threadTimeline";
import {
  ThreadItem,
  ThreadItemAuthor,
  ThreadItemBody,
  ThreadItemContent,
  ThreadItemGroup,
  ThreadItemGutter,
  ThreadItemHeader,
} from "@posthog/quill";
import type {
  Task,
  TaskThreadMessage,
  UserBasic,
} from "@posthog/shared/domain-types";
import { isTerminalStatus } from "@posthog/shared/domain-types";
import { UserAvatar } from "@posthog/ui/features/auth/UserAvatar";
import {
  ThreadArtifactRow,
  ThreadMessageRow,
} from "@posthog/ui/features/canvas/components/ThreadPanel";
import { ThreadTimestamp } from "@posthog/ui/features/canvas/components/ThreadTimestamp";
import { userDisplayName } from "@posthog/ui/features/canvas/utils/userDisplay";
import type { buildConversationItems } from "@posthog/ui/features/sessions/components/buildConversationItems";
import { Fragment, type ReactNode, useMemo } from "react";

type ConversationItem = ReturnType<
  typeof buildConversationItems
>["items"][number];

function ActivityEventRow({
  node,
  title,
  action,
  timestamp,
}: {
  node: ReactNode;
  title: string;
  action?: string;
  timestamp: string;
}) {
  return (
    <div className="flex items-center gap-2 py-1.5 pr-2 pl-2">
      <div className="flex w-10 shrink-0 justify-end">
        <div className="flex w-[2.35rem] justify-center">{node}</div>
      </div>
      <span className="min-w-0 truncate text-[13px]">
        <span className="font-medium text-gray-12">{title}</span>
        {action && <span className="text-muted-foreground"> {action}</span>}
      </span>
      <ThreadTimestamp dateTime={timestamp} />
    </div>
  );
}

function EventNode({ icon }: { icon: ReactNode }) {
  return (
    <span className="relative z-10 flex size-6 items-center justify-center rounded-full bg-gray-3">
      {icon}
    </span>
  );
}

function UserMessageRow({
  author,
  content,
  timestamp,
}: {
  author?: UserBasic | null;
  content: string;
  timestamp: string;
}) {
  return (
    <ThreadItem className="rounded-none">
      <ThreadItemGutter>
        <UserAvatar user={author} size="lg" className="sticky top-2" />
      </ThreadItemGutter>
      <ThreadItemContent>
        <ThreadItemHeader>
          <ThreadItemAuthor>
            {author ? userDisplayName(author) : "You"}
          </ThreadItemAuthor>
          <ThreadTimestamp dateTime={timestamp} />
        </ThreadItemHeader>
        <ThreadItemBody>
          <span className="line-clamp-4 whitespace-pre-wrap break-words text-[13px]">
            {content}
          </span>
        </ThreadItemBody>
      </ThreadItemContent>
    </ThreadItem>
  );
}

export function ActivityTimeline({
  task,
  timeline,
  conversationItems,
  currentUserUuid,
  currentUserEmail,
  isTaskAuthor,
  canForward,
  onSendToAgent,
  onDelete,
}: {
  task: Task;
  timeline: ThreadTimelineRow<TaskThreadMessage>[];
  conversationItems: ConversationItem[];
  currentUserUuid?: string;
  currentUserEmail?: string | null;
  isTaskAuthor: boolean;
  canForward: boolean;
  onSendToAgent: (messageId: string) => void;
  onDelete: (messageId: string) => void;
}) {
  const nodes = useMemo(() => {
    const entries: { key: string; ts: number; node: ReactNode }[] = [];
    const createdTs = Date.parse(task.created_at) || 0;
    entries.push({
      key: "task-created",
      ts: createdTs,
      node: (
        <ActivityEventRow
          node={
            <UserAvatar
              user={task.created_by}
              size="sm"
              className="relative z-10"
            />
          }
          title={task.created_by ? userDisplayName(task.created_by) : "Someone"}
          action="created this task"
          timestamp={task.created_at}
        />
      ),
    });

    for (const item of conversationItems) {
      if (item.type !== "user_message") continue;
      entries.push({
        key: `user-message-${item.id}`,
        ts: item.timestamp,
        node: (
          <UserMessageRow
            author={task.created_by}
            content={item.content}
            timestamp={new Date(item.timestamp).toISOString()}
          />
        ),
      });
    }

    let hasPrArtifact = false;
    for (const row of timeline) {
      if (row.kind === "artifact" && row.artifact.kind === "pr") {
        hasPrArtifact = true;
      }
      entries.push({
        key: `thread-${row.message.id}`,
        ts: row.timestamp,
        node:
          row.kind === "human" ? (
            <ThreadMessageRow
              message={row.message}
              isTaskAuthor={isTaskAuthor}
              isOwnMessage={
                !!currentUserUuid &&
                currentUserUuid === row.message.author?.uuid
              }
              currentUserEmail={currentUserEmail}
              canForward={canForward}
              onSendToAgent={() => onSendToAgent(row.message.id)}
              onDelete={() => onDelete(row.message.id)}
            />
          ) : (
            <ThreadArtifactRow
              artifact={row.artifact}
              createdAt={row.message.created_at}
            />
          ),
      });
    }

    const updatedTs = Date.parse(task.updated_at) || createdTs;
    const outputPr = task.latest_run?.output?.pr_url;
    if (typeof outputPr === "string" && outputPr && !hasPrArtifact) {
      entries.push({
        key: "output-pr",
        ts: updatedTs,
        node: (
          <ThreadArtifactRow
            artifact={{ kind: "pr", url: outputPr }}
            createdAt={task.updated_at}
          />
        ),
      });
    }

    const runStatus = task.latest_run?.status;
    if (runStatus && isTerminalStatus(runStatus)) {
      const succeeded = runStatus === "completed";
      entries.push({
        key: "run-status",
        ts: updatedTs + 1,
        node: (
          <ActivityEventRow
            node={
              <EventNode
                icon={
                  succeeded ? (
                    <CheckCircleIcon
                      size={14}
                      weight="fill"
                      className="text-green-9"
                    />
                  ) : (
                    <XCircleIcon
                      size={14}
                      weight="fill"
                      className="text-red-9"
                    />
                  )
                }
              />
            }
            title={`Task ${runStatus.replace(/_/g, " ")}`}
            timestamp={task.updated_at}
          />
        ),
      });
    }

    return entries.sort((a, b) => a.ts - b.ts);
  }, [
    conversationItems,
    timeline,
    task,
    isTaskAuthor,
    canForward,
    currentUserUuid,
    currentUserEmail,
    onSendToAgent,
    onDelete,
  ]);

  return (
    <div className="relative">
      <div
        aria-hidden
        className="pointer-events-none absolute top-4 bottom-4 left-[1.825rem] w-px bg-border"
      />
      <div className="relative z-10">
        <ThreadItemGroup>
          {nodes.map((entry) => (
            <Fragment key={entry.key}>{entry.node}</Fragment>
          ))}
        </ThreadItemGroup>
      </div>
    </div>
  );
}
