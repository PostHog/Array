import {
  CheckCircleIcon,
  PlusCircleIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import type { ThreadTimelineRow } from "@posthog/core/canvas/threadTimeline";
import {
  cn,
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
import { useThreadNavigationStore } from "@posthog/ui/features/sessions/threadNavigationStore";
import { Fragment, type KeyboardEvent, type ReactNode, useMemo } from "react";

type ConversationItem = ReturnType<
  typeof buildConversationItems
>["items"][number];

/** A lifecycle marker (task created, run finished): an icon bubble and a single
 *  line, in the same size and colour as every other row's copy. Only the icon
 *  distinguishes it, so the pane reads as one typographic system. */
function ActivityEventRow({
  icon,
  label,
  timestamp,
}: {
  icon: ReactNode;
  label: string;
  timestamp: string;
}) {
  return (
    <div className="flex items-center gap-2 py-1.5 pr-2 pl-2">
      <div className="flex w-10 shrink-0 justify-center">
        <span className="relative z-10 flex size-6 items-center justify-center rounded-full bg-gray-3">
          {icon}
        </span>
      </div>
      <span className="min-w-0 truncate text-[13px]">{label}</span>
      <ThreadTimestamp dateTime={timestamp} />
    </div>
  );
}

function UserMessageRow({
  author,
  content,
  timestamp,
  onSelect,
}: {
  author?: UserBasic | null;
  content: string;
  timestamp: string;
  /** Jumps the transcript to this message. Absent once the run is unavailable. */
  onSelect?: () => void;
}) {
  const name = author ? userDisplayName(author) : "You";
  // The row itself is the hit target. `ThreadItem` renders an <article>, which a
  // <button> may not wrap and which can't become one (quill's primitive takes no
  // `render`), so it carries the button role and its own key handling.
  const activation = onSelect
    ? ({
        role: "button",
        tabIndex: 0,
        "aria-label": `Jump to message from ${name}`,
        onClick: onSelect,
        onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          onSelect();
        },
      } as const)
    : {};
  return (
    <ThreadItem
      className={cn("rounded-none", onSelect && "cursor-pointer")}
      {...activation}
    >
      <ThreadItemGutter className="justify-center">
        <UserAvatar user={author} size="sm" className="sticky top-2" />
      </ThreadItemGutter>
      <ThreadItemContent>
        <ThreadItemHeader>
          <ThreadItemAuthor className="text-[13px]">{name}</ThreadItemAuthor>
          <ThreadTimestamp dateTime={timestamp} />
        </ThreadItemHeader>
        {/* `whitespace-pre-wrap` makes the clamp land on the first *written*
            line rather than the first wrapped one. */}
        <ThreadItemBody className="mt-1.5 line-clamp-1 whitespace-pre-wrap text-[13px]">
          {content}
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
  canOpenInPlace,
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
  /** True when the task's transcript and review pane are mounted beside this
   *  pane. False in the channel-home sidebar, where there is nothing to drive —
   *  rows there stay inert and PRs open externally instead of dead-clicking. */
  canOpenInPlace?: boolean;
  onSendToAgent: (messageId: string) => void;
  onDelete: (messageId: string) => void;
}) {
  const requestScrollToMessage = useThreadNavigationStore(
    (state) => state.requestScrollToMessage,
  );

  const nodes = useMemo(() => {
    const entries: { key: string; ts: number; node: ReactNode }[] = [];
    const createdTs = Date.parse(task.created_at) || 0;
    entries.push({
      key: "task-created",
      ts: createdTs,
      node: (
        <ActivityEventRow
          icon={
            <PlusCircleIcon size={14} weight="fill" className="text-gray-11" />
          }
          label={`${task.created_by ? userDisplayName(task.created_by) : "Someone"} created this task`}
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
            onSelect={
              canOpenInPlace
                ? () => requestScrollToMessage(task.id, item.id)
                : undefined
            }
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
              preview
              onSendToAgent={() => onSendToAgent(row.message.id)}
              onDelete={() => onDelete(row.message.id)}
            />
          ) : (
            <ThreadArtifactRow
              artifact={row.artifact}
              createdAt={row.message.created_at}
              openInPlaceTaskId={canOpenInPlace ? task.id : undefined}
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
            openInPlaceTaskId={canOpenInPlace ? task.id : undefined}
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
            icon={
              succeeded ? (
                <CheckCircleIcon
                  size={14}
                  weight="fill"
                  className="text-green-9"
                />
              ) : (
                <XCircleIcon size={14} weight="fill" className="text-red-9" />
              )
            }
            label={`Task ${runStatus.replace(/_/g, " ")}`}
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
    canOpenInPlace,
    requestScrollToMessage,
  ]);

  return (
    <div className="relative">
      {/* Every row centers its node in a 2.5rem gutter inset by the row's
          0.5rem padding, so the line runs through 0.5 + 2.5/2 = 1.75rem. */}
      <div
        aria-hidden
        className="pointer-events-none absolute top-4 bottom-4 left-[1.75rem] w-px bg-border"
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
