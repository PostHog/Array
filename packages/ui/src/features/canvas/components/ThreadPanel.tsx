import {
  ArrowSquareOutIcon,
  CaretRightIcon,
  DotsThreeIcon,
  PaperPlaneRightIcon,
  RobotIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import {
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  InputGroupAddon,
  InputGroupButton,
  Skeleton,
  SkeletonText,
  Spinner,
  ThreadItem,
  ThreadItemAction,
  ThreadItemActions,
  ThreadItemAuthor,
  ThreadItemBody,
  ThreadItemContent,
  ThreadItemGroup,
  ThreadItemGutter,
  ThreadItemHeader,
} from "@posthog/quill";
import { ANALYTICS_EVENTS } from "@posthog/shared/analytics-events";
import type {
  Task,
  TaskThreadMessage,
  UserBasic,
} from "@posthog/shared/domain-types";
import { isTerminalStatus } from "@posthog/shared/domain-types";
import { useOptionalAuthenticatedClient } from "@posthog/ui/features/auth/authClient";
import { useCurrentUser } from "@posthog/ui/features/auth/useCurrentUser";
import { getUserInitials } from "@posthog/ui/features/auth/userInitials";
import { TaskCard } from "@posthog/ui/features/canvas/components/ChannelFeedView";
import { MentionComposer } from "@posthog/ui/features/canvas/components/MentionComposer";
import { MentionText } from "@posthog/ui/features/canvas/components/MentionText";
import { ThreadTimestamp } from "@posthog/ui/features/canvas/components/ThreadTimestamp";
import { useOrgMembers } from "@posthog/ui/features/canvas/hooks/useOrgMembers";
import {
  useTaskThread,
  useTaskThreadMutations,
} from "@posthog/ui/features/canvas/hooks/useTaskThread";
import { userDisplayName } from "@posthog/ui/features/canvas/utils/userDisplay";
import type { ConversationItem } from "@posthog/ui/features/sessions/components/buildConversationItems";
import {
  ChatMarkdown,
  ChatStreamingMarkdown,
} from "@posthog/ui/features/sessions/components/chat-thread/ChatMarkdown";
import { extractChannelContext } from "@posthog/ui/features/sessions/components/session-update/channelContext";
import { useConversationItems } from "@posthog/ui/features/sessions/hooks/useConversationItems";
import { useSessionCallbacks } from "@posthog/ui/features/sessions/hooks/useSessionCallbacks";
import { useSessionConnection } from "@posthog/ui/features/sessions/hooks/useSessionConnection";
import { useSessionViewState } from "@posthog/ui/features/sessions/hooks/useSessionViewState";
import { usePendingPermissionsForTask } from "@posthog/ui/features/sessions/sessionStore";
import { taskDetailQuery } from "@posthog/ui/features/tasks/queries";
import { toast } from "@posthog/ui/primitives/toast";
import { track } from "@posthog/ui/shell/analytics";
import { Text } from "@radix-ui/themes";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

function ThreadMessageRow({
  message,
  isTaskAuthor,
  isOwnMessage,
  currentUserEmail,
  canForward,
  onSendToAgent,
  onDelete,
}: {
  message: TaskThreadMessage;
  /** Whether the current user authored the task (may forward to the agent). */
  isTaskAuthor: boolean;
  isOwnMessage: boolean;
  currentUserEmail?: string | null;
  canForward: boolean;
  onSendToAgent: () => void;
  onDelete: () => void;
}) {
  const forwarded = !!message.forwarded_to_agent_at;
  const showMenu = (isTaskAuthor && !forwarded) || isOwnMessage;

  return (
    <ThreadItem>
      <ThreadItemGutter>
        <Avatar size="lg" className="sticky top-2">
          <AvatarFallback>{getUserInitials(message.author)}</AvatarFallback>
        </Avatar>
      </ThreadItemGutter>
      <ThreadItemContent>
        <ThreadItemHeader>
          <ThreadItemAuthor>{userDisplayName(message.author)}</ThreadItemAuthor>
          <ThreadTimestamp dateTime={message.created_at} />
        </ThreadItemHeader>
        <ThreadItemBody>
          <MentionText
            content={message.content}
            currentUserEmail={currentUserEmail}
          />
        </ThreadItemBody>
        {forwarded && (
          <Badge variant="info" className="w-fit">
            <RobotIcon size={10} />
            Sent to agent
          </Badge>
        )}
      </ThreadItemContent>
      {showMenu && (
        <ThreadItemActions>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <ThreadItemAction label="Message actions">
                  <DotsThreeIcon size={14} />
                </ThreadItemAction>
              }
            />
            <DropdownMenuContent align="end">
              {isTaskAuthor && !forwarded && (
                <DropdownMenuItem
                  disabled={!canForward}
                  onClick={onSendToAgent}
                >
                  <PaperPlaneRightIcon size={14} />
                  Send to agent
                </DropdownMenuItem>
              )}
              {isOwnMessage && (
                <DropdownMenuItem variant="destructive" onClick={onDelete}>
                  <TrashIcon size={14} />
                  Delete message
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </ThreadItemActions>
      )}
    </ThreadItem>
  );
}

type AgentPhase = "active" | "needs_input" | "complete" | "error";

interface AgentStatus {
  phase: AgentPhase;
  label: string;
}

interface AgentMessage {
  id: string;
  text: string;
  ts?: number;
}

// One entry per agent turn, holding only that turn's *last* spoken message —
// the summary the agent lands on ("Done — …", "Draft PR is open: …"). Turns are
// split on user prompts (the initial task, and each button/steer that starts a
// new turn), so the whole of a turn's work collapses to a single, continuously
// updating bubble instead of one bubble per intermediate chunk. Tool calls,
// thoughts, and diffs stay in the full task view.
function agentTurns(items: ConversationItem[]): AgentMessage[] {
  const turns: AgentMessage[] = [];
  let current: AgentMessage | null = null;
  for (const item of items) {
    if (item.type === "user_message") {
      // A new prompt starts a new turn; keep the turn we just finished.
      if (current) turns.push(current);
      current = null;
      continue;
    }
    if (
      item.type === "session_update" &&
      item.update.sessionUpdate === "agent_message_chunk" &&
      "content" in item.update &&
      item.update.content.type === "text" &&
      item.update.content.text.trim()
    ) {
      // Overwrite so only the turn's latest message survives.
      current = {
        id: item.id,
        text: item.update.content.text,
        ts: item.timestamp,
      };
    }
  }
  if (current) turns.push(current);
  return turns;
}

// The prompts the user sent the agent — the initial task and each steer — so
// the thread shows *what was asked* next to the agent's replies. The first
// prompt carries the channel CONTEXT.md block the saga prepended; strip it so
// the row reads as the human's actual request.
function agentPrompts(items: ConversationItem[]): AgentMessage[] {
  const prompts: AgentMessage[] = [];
  for (const item of items) {
    if (item.type !== "user_message") continue;
    const text = (
      extractChannelContext(item.content)?.stripped ?? item.content
    ).trim();
    if (!text) continue;
    prompts.push({ id: item.id, text, ts: item.timestamp });
  }
  return prompts;
}

function AgentStatusChip({ status }: { status: AgentStatus }) {
  switch (status.phase) {
    case "active":
      return (
        <span className="flex items-center gap-1 text-muted-foreground">
          <Spinner className="size-3" />
          <Text size="1">{status.label}</Text>
        </span>
      );
    case "needs_input":
      return <Badge variant="warning">{status.label}</Badge>;
    case "error":
      return <Badge variant="destructive">{status.label}</Badge>;
    default:
      return <Badge variant="success">{status.label}</Badge>;
  }
}

// One agent turn as its own thread item — a full avatar/"Agent" header row with
// a timestamp, the turn's final message, and (on the current turn) the live
// status chip. The live turn's bubble streams; settled turns render static and
// stay put as new turns arrive below.
function AgentTurnRow({
  message,
  status,
  streaming,
}: {
  message?: AgentMessage;
  /** The live status chip; only the current turn passes one. */
  status?: AgentStatus;
  streaming: boolean;
}) {
  return (
    <ThreadItem>
      <ThreadItemGutter>
        <Avatar size="lg" className="sticky top-2">
          <AvatarFallback>
            <RobotIcon size={14} />
          </AvatarFallback>
        </Avatar>
      </ThreadItemGutter>
      <ThreadItemContent>
        <ThreadItemHeader>
          <ThreadItemAuthor>Agent</ThreadItemAuthor>
          {status && <AgentStatusChip status={status} />}
          {message?.ts !== undefined && (
            <ThreadTimestamp dateTime={new Date(message.ts).toISOString()} />
          )}
        </ThreadItemHeader>
        {message?.text && (
          <ThreadItemBody>
            <div className="rounded-md border border-border bg-muted px-2 py-1.5">
              {streaming ? (
                <ChatStreamingMarkdown content={message.text} />
              ) : (
                <ChatMarkdown content={message.text} />
              )}
            </div>
          </ThreadItemBody>
        )}
      </ThreadItemContent>
    </ThreadItem>
  );
}

// A prompt the user sent the agent (the task or a steer), rendered as a human
// message so the thread shows what was asked. Attributed to the task creator —
// conversation items don't carry a per-prompt author, and the task owner is who
// kicked the run off.
function UserPromptRow({
  message,
  author,
}: {
  message: AgentMessage;
  author: TaskThreadMessage["author"];
}) {
  return (
    <ThreadItem>
      <ThreadItemGutter>
        <Avatar size="lg" className="sticky top-2">
          <AvatarFallback>{getUserInitials(author)}</AvatarFallback>
        </Avatar>
      </ThreadItemGutter>
      <ThreadItemContent>
        <ThreadItemHeader>
          <ThreadItemAuthor>{userDisplayName(author)}</ThreadItemAuthor>
          {message.ts !== undefined && (
            <ThreadTimestamp dateTime={new Date(message.ts).toISOString()} />
          )}
        </ThreadItemHeader>
        <ThreadItemBody className="wrap-break-word whitespace-pre-wrap">
          {message.text}
        </ThreadItemBody>
      </ThreadItemContent>
    </ThreadItem>
  );
}

// One row in the merged thread timeline: a human thread message, a user prompt
// to the agent, or an agent turn — interleaved by timestamp so the conversation
// reads chronologically (latest at the bottom) instead of pinning all agent
// activity below the human replies.
type TimelineRow =
  | { kind: "human"; ts: number; message: TaskThreadMessage }
  | { kind: "prompt"; ts: number; message: AgentMessage }
  | { kind: "agent"; ts: number; message: AgentMessage };

// Placeholder rows shown until the thread and the agent session have both
// settled. Mirrors the ThreadItem layout so the real timeline swaps in without
// a jump — and, crucially, keeps the agent status hidden until it's real, so
// the panel never flashes a premature "Working…" while the session connects.
function ThreadTimelineSkeleton() {
  return (
    <ThreadItemGroup aria-hidden>
      {[0, 1, 2].map((i) => (
        <ThreadItem key={i}>
          <ThreadItemGutter>
            <Skeleton className="size-8 rounded-full" />
          </ThreadItemGutter>
          <ThreadItemContent>
            <ThreadItemHeader>
              <Skeleton className="h-3.5 w-24 rounded" />
            </ThreadItemHeader>
            <SkeletonText lines={i === 1 ? 3 : 2} />
          </ThreadItemContent>
        </ThreadItem>
      ))}
    </ThreadItemGroup>
  );
}

// The merged thread + task conversation: a task card pinned at the top, the
// human thread, and a single live agent status message pinned at the bottom.
// Owns the session connection (so the agent keeps streaming while the panel is
// open), which is why it only mounts when the panel is expanded and the task is
// known.
function ThreadConversation({
  task,
  onClose,
  onToggleCollapsed,
  onOpenFull,
}: {
  task: Task;
  onClose?: () => void;
  onToggleCollapsed?: () => void;
  onOpenFull?: () => void;
}) {
  const taskId = task.id;
  const client = useOptionalAuthenticatedClient();
  const { data: currentUser } = useCurrentUser({ client });

  const { messages, isLoading } = useTaskThread(taskId);
  const {
    postMessage,
    deleteMessage,
    sendToAgent,
    isPosting,
    isSendingToAgent,
  } = useTaskThreadMutations(taskId);
  const { members } = useOrgMembers();

  // Live agent session — keep it connected while the panel is open so the
  // agent's status streams in alongside the human thread.
  const {
    session,
    repoPath,
    isCloud,
    events,
    cloudStatus,
    isPromptPending,
    isInitializing,
    hasError,
    errorTitle,
  } = useSessionViewState(taskId, task);
  // Reading a thread must never START agent work: for a local task with no
  // run and no live session, reconcile would connect fresh and replay the
  // task description as an initial prompt (task-detail's interrupted-creation
  // recovery). Suspend the connection in that state — it resumes as soon as a
  // run exists or a session is live.
  const hasRunOrSession = Boolean(task.latest_run?.id) || Boolean(session);
  useSessionConnection({
    taskId,
    task,
    session,
    repoPath,
    isCloud,
    isSuspended: !isCloud && !hasRunOrSession,
  });
  const { items } = useConversationItems(events, isPromptPending);
  const pendingPermissions = usePendingPermissionsForTask(taskId);
  useSessionCallbacks({
    taskId,
    task,
    session,
    repoPath,
  });

  const prUrl =
    typeof task.latest_run?.output?.pr_url === "string"
      ? task.latest_run.output.pr_url
      : undefined;

  const agentMsgs = useMemo(() => agentTurns(items), [items]);
  const promptMsgs = useMemo(() => agentPrompts(items), [items]);

  const agentStatus = useMemo<AgentStatus | null>(() => {
    const hasActivity = events.length > 0 || !!task.latest_run;
    if (!hasActivity) return null;
    // Note: `isRunning` is deliberately not used here — for cloud tasks it stays
    // true until the whole run is terminal, so it can't tell "agent is typing"
    // from "agent finished and is waiting". `isPromptPending` is the accurate
    // "producing right now" signal; permissions mean it's blocked on the user.
    if (hasError || cloudStatus === "failed") {
      return { phase: "error", label: errorTitle ?? "Failed" };
    }
    if (pendingPermissions.size > 0) {
      return { phase: "needs_input", label: "Needs input" };
    }
    if (isPromptPending || isInitializing) {
      return { phase: "active", label: "Working…" };
    }
    return { phase: "complete", label: prUrl ? "Shipped" : "Ready to ship" };
  }, [
    events.length,
    task.latest_run,
    hasError,
    cloudStatus,
    errorTitle,
    pendingPermissions.size,
    isPromptPending,
    isInitializing,
    prUrl,
  ]);

  // User prompts, human thread messages, and agent turns woven into one
  // chronological list. Ties keep insertion order (prompts, then humans, then
  // agents); an agent turn with no timestamp yet (just started, still streaming)
  // sorts to the end so it stays at the bottom.
  const timeline = useMemo<TimelineRow[]>(() => {
    const rows: TimelineRow[] = [
      ...promptMsgs.map(
        (message): TimelineRow => ({
          kind: "prompt",
          ts: message.ts ?? 0,
          message,
        }),
      ),
      ...messages.map(
        (message): TimelineRow => ({
          kind: "human",
          ts: Date.parse(message.created_at) || 0,
          message,
        }),
      ),
      ...agentMsgs.map(
        (message): TimelineRow => ({
          kind: "agent",
          ts: message.ts ?? Number.MAX_SAFE_INTEGER,
          message,
        }),
      ),
    ];
    return rows.sort((a, b) => a.ts - b.ts);
  }, [promptMsgs, messages, agentMsgs]);

  // The status chip + ship actions ride the newest agent turn; when the agent
  // has spoken nothing yet they hang off a trailing status-only row instead.
  const lastAgentId = agentMsgs[agentMsgs.length - 1]?.id;

  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const handleMentionInsert = useCallback(
    (member: UserBasic) => {
      track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
        action_type: "mention_member",
        surface: "thread_panel",
        task_id: taskId,
        mentioned_user_id: member.uuid,
      });
    },
    [taskId],
  );

  // Keep the newest content in view, Slack-style.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on new content
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [
    messages.length,
    promptMsgs.length,
    agentMsgs.length,
    agentMsgs[agentMsgs.length - 1]?.text,
    agentStatus?.phase,
  ]);

  const isTaskAuthor =
    !!currentUser?.uuid && currentUser.uuid === task.created_by?.uuid;
  // Forwarding needs a run the workflow can still signal, one send at a time.
  const canForward =
    !!task.latest_run &&
    !isTerminalStatus(task.latest_run.status) &&
    !isSendingToAgent;

  const submit = () => {
    const content = draft.trim();
    if (!content || isPosting) return;
    setDraft("");
    postMessage(content).catch((error: unknown) => {
      setDraft(content);
      toast.error("Couldn't post message", {
        description: error instanceof Error ? error.message : String(error),
      });
    });
  };

  const handleSendToAgent = (messageId: string) => {
    sendToAgent(messageId).catch((error: unknown) => {
      toast.error("Couldn't send message to agent", {
        description: error instanceof Error ? error.message : String(error),
      });
    });
  };

  const handleDelete = (messageId: string) => {
    deleteMessage(messageId).catch((error: unknown) => {
      toast.error("Couldn't delete message", {
        description: error instanceof Error ? error.message : String(error),
      });
    });
  };

  const isEmpty = timeline.length === 0 && !agentStatus;
  // Skeleton the conversation until the human thread has loaded and the agent
  // session has finished initializing. Gating on `isInitializing` is what keeps
  // the premature "Working…" status off-screen — it only appears once the
  // session is settled and the status is real.
  const isReady = !isInitializing && !isLoading;

  return (
    <div className="flex h-full min-w-0 flex-col bg-gray-1">
      <div className="flex items-center gap-1 border-border border-b px-3 py-2">
        <div className="min-w-0 flex-1">
          <Text size="2" weight="medium" className="block">
            Thread
          </Text>
        </div>
        {onOpenFull && (
          <Button
            variant="default"
            size="icon-sm"
            aria-label="Open full task"
            onClick={onOpenFull}
          >
            <ArrowSquareOutIcon size={14} />
          </Button>
        )}
        {onToggleCollapsed && (
          <Button
            variant="default"
            size="icon-sm"
            aria-label="Collapse thread"
            onClick={onToggleCollapsed}
          >
            <CaretRightIcon size={14} />
          </Button>
        )}
        {onClose && (
          <Button
            variant="default"
            size="icon-sm"
            aria-label="Close thread"
            onClick={onClose}
          >
            <XIcon size={14} />
          </Button>
        )}
      </div>

      <div className="z-10 px-2">
        <TaskCard task={task} onOpen={() => onOpenFull?.()} />
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {!isReady ? (
          <ThreadTimelineSkeleton />
        ) : isEmpty ? (
          <div className="px-2 py-6 text-center">
            <Text size="1" className="text-muted-foreground">
              Discuss this task with your team. The agent's status shows up here
              too; messages stay between humans unless the task author sends one
              to the agent.
            </Text>
          </div>
        ) : (
          <ThreadItemGroup>
            {timeline.map((row) =>
              row.kind === "prompt" ? (
                <UserPromptRow
                  key={row.message.id}
                  message={row.message}
                  author={task.created_by}
                />
              ) : row.kind === "human" ? (
                <ThreadMessageRow
                  key={row.message.id}
                  message={row.message}
                  isTaskAuthor={isTaskAuthor}
                  isOwnMessage={
                    !!currentUser?.uuid &&
                    currentUser.uuid === row.message.author?.uuid
                  }
                  currentUserEmail={currentUser?.email}
                  canForward={canForward}
                  onSendToAgent={() => handleSendToAgent(row.message.id)}
                  onDelete={() => handleDelete(row.message.id)}
                />
              ) : (
                <AgentTurnRow
                  key={row.message.id}
                  message={row.message}
                  streaming={
                    row.message.id === lastAgentId &&
                    agentStatus?.phase === "active"
                  }
                />
              ),
            )}
            {/* The live status + ship actions stay pinned at the bottom rather
                than riding the (chronologically-placed) agent turn — otherwise a
                human reply sent after the agent finished would push the "Create
                PR" action above it, out of view. Once a PR exists the agent's
                "Done" message already reflects it, so the footer is dropped. */}
            {agentStatus && !(agentStatus.phase === "complete" && !!prUrl) && (
              <AgentTurnRow status={agentStatus} streaming={false} />
            )}
          </ThreadItemGroup>
        )}
      </div>

      <div className="border-border border-t p-2">
        <MentionComposer
          value={draft}
          onValueChange={setDraft}
          onSubmit={submit}
          members={members}
          onMentionInsert={handleMentionInsert}
          placeholder="Reply in thread… @ to tag a teammate"
          rows={2}
          inputClassName="max-h-40 text-[13px]"
        >
          <InputGroupAddon align="block-end" className="p-1">
            <span className="ml-auto flex items-center gap-1">
              <InputGroupButton
                variant="primary"
                size="icon-sm"
                aria-label="Send"
                disabled={!draft.trim() || isPosting}
                onClick={submit}
              >
                <PaperPlaneRightIcon size={14} />
              </InputGroupButton>
            </span>
          </InputGroupAddon>
        </MentionComposer>
      </div>
    </div>
  );
}

// The right-hand thread dock: the human conversation around a task merged with
// the agent's live status and a pinned task card. Nothing a human types here
// reaches the agent unless the task author explicitly forwards a message ("Send
// to agent" in the row's hover menu). Collapses to a thin rail.
export function ThreadPanel({
  taskId,
  task: taskProp,
  onClose,
  collapsed,
  onToggleCollapsed,
  onOpenFull,
}: {
  taskId: string;
  /** The thread's task when the caller already has it; fetched otherwise. */
  task?: Task;
  onClose?: () => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  onOpenFull?: () => void;
}) {
  const { data: fetchedTask } = useQuery({
    ...taskDetailQuery(taskId),
    enabled: !taskProp && !collapsed,
  });
  const task = taskProp ?? fetchedTask;

  if (collapsed) {
    return (
      <div className="flex h-full w-9 flex-col items-center border-border border-l bg-gray-1 py-2">
        <Button
          variant="default"
          size="icon-sm"
          aria-label="Expand thread"
          onClick={onToggleCollapsed}
        >
          <CaretRightIcon size={14} className="rotate-180" />
        </Button>
      </div>
    );
  }

  if (!task) {
    return (
      <div className="flex h-full min-w-0 flex-col items-center justify-center bg-gray-1">
        <Spinner />
      </div>
    );
  }

  return (
    <ThreadConversation
      task={task}
      onClose={onClose}
      onToggleCollapsed={onToggleCollapsed}
      onOpenFull={onOpenFull}
    />
  );
}
