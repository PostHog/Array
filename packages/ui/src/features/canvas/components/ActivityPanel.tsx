import { CaretRightIcon } from "@phosphor-icons/react";
import { Button, cn, Tabs, TabsList, TabsTrigger } from "@posthog/quill";
import { ANALYTICS_EVENTS } from "@posthog/shared/analytics-events";
import type { Task } from "@posthog/shared/domain-types";
import { ActivityTimeline } from "@posthog/ui/features/canvas/components/ActivityTimeline";
import { TaskCard } from "@posthog/ui/features/canvas/components/ChannelFeedView";
import { TaskArtifactsList } from "@posthog/ui/features/canvas/components/TaskArtifactsList";
import {
  AgentStatusLine,
  ThreadLoadingState,
  ThreadPanelHeader,
  ThreadReplyComposer,
  ThreadTimeline,
} from "@posthog/ui/features/canvas/components/ThreadPanel";
import { useThreadConversation } from "@posthog/ui/features/canvas/hooks/useThreadConversation";
import { buildConversationItems } from "@posthog/ui/features/sessions/components/buildConversationItems";
import { taskDetailQuery } from "@posthog/ui/features/tasks/queries";
import { track } from "@posthog/ui/shell/analytics";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type ActivityTab = "timeline" | "artifacts" | "comments";

const ACTIVITY_TABS: readonly { key: ActivityTab; label: string }[] = [
  { key: "timeline", label: "Timeline" },
  { key: "artifacts", label: "Artifacts" },
  { key: "comments", label: "Comments" },
] as const;

const TABS_WITH_COMPOSER: ReadonlySet<ActivityTab> = new Set([
  "timeline",
  "comments",
]);

const TIMESTAMP_END_CLASS =
  "[&_[data-slot=thread-item-timestamp]]:ml-auto [&_[data-slot=thread-item-timestamp]]:shrink-0 [&_[data-slot=thread-item-timestamp]]:pl-2";

function ActivityTabsRow({
  tab,
  onTabChange,
}: {
  tab: ActivityTab;
  onTabChange: (tab: ActivityTab) => void;
}) {
  return (
    <div className="shrink-0 border-border border-b px-2 py-1.5">
      <Tabs
        value={tab}
        onValueChange={(value: string) => onTabChange(value as ActivityTab)}
      >
        <TabsList variant="line" className="h-auto gap-0.5">
          {ACTIVITY_TABS.map((t) => (
            <TabsTrigger key={t.key} value={t.key} className="px-2.5 py-1">
              <span className="font-medium text-[13px]">{t.label}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  );
}

function ActivityConversation({
  task,
  channelId,
  onClose,
  onToggleCollapsed,
  onOpenFull,
  showTaskSummary,
}: {
  task: Task;
  channelId: string;
  onClose?: () => void;
  onToggleCollapsed?: () => void;
  onOpenFull?: () => void;
  showTaskSummary: boolean;
}) {
  const taskId = task.id;
  const {
    timeline,
    agentStatus,
    events,
    isPromptPending,
    isReady,
    members,
    currentUser,
    isTaskAuthor,
    canForward,
    draft,
    setDraft,
    isSubmitDisabled,
    submit,
    sendMessageToAgent,
    deleteMessage,
    onMentionInsert,
  } = useThreadConversation(task, { surface: "activity_panel" });

  const [tab, setTab] = useState<ActivityTab>("timeline");
  const handleTabChange = useCallback(
    (next: ActivityTab) => {
      setTab(next);
      track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
        action_type: "activity_tab_change",
        surface: "activity_panel",
        task_id: taskId,
        tab: next,
      });
    },
    [taskId],
  );

  const commentRows = useMemo(
    () => timeline.filter((row) => row.kind === "human"),
    [timeline],
  );
  const conversationItems = useMemo(
    () =>
      tab === "timeline"
        ? buildConversationItems(events, isPromptPending).items
        : [],
    [tab, events, isPromptPending],
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when rendered thread content changes
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [timeline, events.length, agentStatus?.phase, tab]);

  const showComposer = TABS_WITH_COMPOSER.has(tab);

  const body = () => {
    if (tab === "artifacts") {
      return <TaskArtifactsList task={task} timeline={timeline} />;
    }
    if (tab === "comments") {
      return (
        <ThreadTimeline
          timeline={commentRows}
          isReady={isReady}
          currentUserUuid={currentUser?.uuid}
          currentUserEmail={currentUser?.email}
          isTaskAuthor={isTaskAuthor}
          canForward={canForward}
          onSendToAgent={sendMessageToAgent}
          onDelete={deleteMessage}
        />
      );
    }
    if (!isReady) return <ThreadLoadingState />;
    return (
      <ActivityTimeline
        task={task}
        timeline={timeline}
        conversationItems={conversationItems}
        currentUserUuid={currentUser?.uuid}
        currentUserEmail={currentUser?.email}
        isTaskAuthor={isTaskAuthor}
        canForward={canForward}
        onSendToAgent={sendMessageToAgent}
        onDelete={deleteMessage}
      />
    );
  };

  return (
    <div
      className={cn(
        "flex h-full min-w-0 flex-col bg-gray-1",
        TIMESTAMP_END_CLASS,
      )}
    >
      <ThreadPanelHeader
        title="Activity"
        onOpenFull={onOpenFull}
        onToggleCollapsed={onToggleCollapsed}
        onClose={onClose}
      />
      <ActivityTabsRow tab={tab} onTabChange={handleTabChange} />

      {showTaskSummary && (
        <div className="z-10 px-2">
          <TaskCard task={task} channelId={channelId} inThread />
        </div>
      )}
      <div
        ref={scrollRef}
        aria-busy={!isReady}
        className="flex-1 overflow-y-auto"
      >
        {body()}
      </div>

      {showComposer && agentStatus && <AgentStatusLine status={agentStatus} />}

      {showComposer && (
        <ThreadReplyComposer
          draft={draft}
          onDraftChange={setDraft}
          onSubmit={submit}
          members={members}
          allowAgentMention={isTaskAuthor && canForward}
          onMentionInsert={onMentionInsert}
          disabled={isSubmitDisabled}
        />
      )}
    </div>
  );
}

export function ActivityPanel({
  taskId,
  channelId,
  task: taskProp,
  onClose,
  collapsed,
  onToggleCollapsed,
  onOpenFull,
  showTaskSummary = true,
}: {
  taskId: string;
  channelId: string;
  task?: Task;
  onClose?: () => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  onOpenFull?: () => void;
  showTaskSummary?: boolean;
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
          aria-label="Expand activity"
          onClick={onToggleCollapsed}
        >
          <CaretRightIcon size={14} className="rotate-180" />
        </Button>
      </div>
    );
  }

  if (!task) {
    return <ThreadLoadingState />;
  }

  return (
    <ActivityConversation
      task={task}
      channelId={channelId}
      onClose={onClose}
      onToggleCollapsed={onToggleCollapsed}
      onOpenFull={onOpenFull}
      showTaskSummary={showTaskSummary}
    />
  );
}
