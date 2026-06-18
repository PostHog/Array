import { ArrowDown, XCircle } from "@phosphor-icons/react";
import { WorkerPoolContextProvider } from "@pierre/diffs/react";
import { useService } from "@posthog/di/react";
import {
  Button,
  cn,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@posthog/quill";
import type { AcpMessage } from "@posthog/shared";
import type { Task } from "@posthog/shared/domain-types";
import type {
  ConversationItem,
  TurnContext,
} from "@posthog/ui/features/sessions/components/buildConversationItems";
import { ConversationSearchBar } from "@posthog/ui/features/sessions/components/ConversationSearchBar";
import { GitActionMessage } from "@posthog/ui/features/sessions/components/GitActionMessage";
import { GitActionResult } from "@posthog/ui/features/sessions/components/GitActionResult";
import { mergeConversationItems } from "@posthog/ui/features/sessions/components/mergeConversationItems";
import {
  buildThreadGroups,
  type ThreadGrouping,
  type ThreadRow,
} from "@posthog/ui/features/sessions/components/new-thread/buildThreadGroups";
import { ToolCallGroupChip } from "@posthog/ui/features/sessions/components/new-thread/ToolCallGroupChip";
import { SessionFooter } from "@posthog/ui/features/sessions/components/SessionFooter";
import { QueuedMessageView } from "@posthog/ui/features/sessions/components/session-update/QueuedMessageView";
import {
  type RenderItem,
  SessionUpdateView,
} from "@posthog/ui/features/sessions/components/session-update/SessionUpdateView";
import { UserMessage } from "@posthog/ui/features/sessions/components/session-update/UserMessage";
import { UserShellExecuteView } from "@posthog/ui/features/sessions/components/session-update/UserShellExecuteView";
import {
  VirtualizedList,
  type VirtualizedListHandle,
} from "@posthog/ui/features/sessions/components/VirtualizedList";
import { CHAT_CONTENT_MAX_WIDTH } from "@posthog/ui/features/sessions/constants";
import { useContextUsage } from "@posthog/ui/features/sessions/hooks/useContextUsage";
import { useConversationItems } from "@posthog/ui/features/sessions/hooks/useConversationItems";
import { useConversationSearch } from "@posthog/ui/features/sessions/hooks/useConversationSearch";
import {
  sessionStoreSetters,
  useOptimisticItemsForTask,
  usePendingPermissionsForTask,
  useQueuedMessagesForTask,
  useSessionForTask,
} from "@posthog/ui/features/sessions/sessionStore";
import {
  useGroupOverrides,
  useSessionViewActions,
} from "@posthog/ui/features/sessions/sessionViewStore";
import { SessionTaskIdProvider } from "@posthog/ui/features/sessions/useSessionTaskId";
import { useSettingsStore } from "@posthog/ui/features/settings/settingsStore";
import { SkillButtonActionMessage } from "@posthog/ui/features/skill-buttons/components/SkillButtonActionMessage";
import {
  DIFF_WORKER_FACTORY,
  type DiffWorkerFactory,
} from "@posthog/ui/shell/diffWorkerHost";
import { Box, Flex, Text } from "@radix-ui/themes";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

const DIFFS_HIGHLIGHTER_OPTIONS = {
  theme: { dark: "github-dark" as const, light: "github-light" as const },
};

interface ConversationViewProps {
  events: AcpMessage[];
  isPromptPending: boolean | null;
  promptStartedAt?: number | null;
  repoPath?: string | null;
  taskId?: string;
  task?: Task;
  slackThreadUrl?: string;
  compact?: boolean;
}

export function ConversationView({
  events,
  isPromptPending,
  promptStartedAt,
  repoPath,
  taskId,
  task,
  slackThreadUrl,
  compact = false,
}: ConversationViewProps) {
  const diffWorkerFactory = useService<DiffWorkerFactory>(DIFF_WORKER_FACTORY);
  const diffsPoolOptions = useMemo(
    () => ({
      workerFactory: () => diffWorkerFactory(),
      totalASTLRUCacheSize: 200,
    }),
    [diffWorkerFactory],
  );

  const listRef = useRef<VirtualizedListHandle>(null);
  const isAtBottomRef = useRef(true);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const debugLogsCloudRuns = useSettingsStore((s) => s.debugLogsCloudRuns);
  const showDebugLogs = debugLogsCloudRuns;

  const collapseMode = useSettingsStore((s) => s.conversationCollapseMode);
  const groupOverrides = useGroupOverrides();
  const sessionViewActions = useSessionViewActions();

  const contextUsage = useContextUsage(events);

  // Streaming appends one event per token. The parse is incremental — each
  // event is handled once and completed turns are reused by reference — so per
  // token the work tracks the active turn, not the whole thread. We feed
  // `events` directly (no frame-throttle) so a sent message's optimistic->real
  // swap is never delayed past the frame the store commits it.
  const {
    items: conversationItems,
    lastTurnInfo,
    isCompacting,
    completedToolCallCount,
  } = useConversationItems(events, isPromptPending, {
    showDebugLogs,
  });

  const firstUserMessageIdRef = useRef<string | undefined>(undefined);
  if (firstUserMessageIdRef.current === undefined) {
    firstUserMessageIdRef.current = conversationItems.find(
      (i) => i.type === "user_message",
    )?.id;
  }
  const firstUserMessageId = firstUserMessageIdRef.current;

  const [initialItemIds] = useState(
    () =>
      new Set(
        conversationItems
          .filter((i) => i.type === "user_message")
          .map((i) => i.id),
      ),
  );

  const pendingPermissions = usePendingPermissionsForTask(taskId ?? "");
  const pendingPermissionsCount = pendingPermissions.size;
  const queuedMessages = useQueuedMessagesForTask(taskId);
  const optimisticItems = useOptimisticItemsForTask(taskId);
  const session = useSessionForTask(taskId);
  const pausedDurationMs = session?.pausedDurationMs ?? 0;

  const queuedItems = useMemo<Extract<ConversationItem, { type: "queued" }>[]>(
    () =>
      queuedMessages.map((msg) => ({
        type: "queued" as const,
        id: msg.id,
        message: msg,
      })),
    [queuedMessages],
  );

  const isCloud = session?.isCloud ?? false;

  const items = useMemo<ConversationItem[]>(
    () =>
      mergeConversationItems({
        conversationItems,
        optimisticItems,
        queuedItems,
        isCloud,
      }),
    [conversationItems, optimisticItems, queuedItems, isCloud],
  );

  // Fold each completed turn's tool-call work into a collapsible chip, and emit
  // the keepMounted indices (standalone MCP-app rows, whose iframes must survive
  // scrolling) + the item→row map in the same pass.
  const grouping = useMemo<ThreadGrouping>(
    () => buildThreadGroups(items, collapseMode, groupOverrides),
    [items, collapseMode, groupOverrides],
  );
  const threadRows = grouping.rows;
  const rowKeepMounted = grouping.keepMounted;
  const itemIdToRowIndex = grouping.idToRowIndex;

  // Changing the global mode wipes ephemeral per-chip overrides.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally keyed on collapseMode only
  useEffect(() => {
    sessionViewActions.clearGroupOverrides();
  }, [collapseMode]);

  const containerRef = useRef<HTMLDivElement>(null);

  // Adapter so search (which scrolls by item index) lands on the right row,
  // since grouped rows != items.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const itemIdToRowIndexRef = useRef(itemIdToRowIndex);
  itemIdToRowIndexRef.current = itemIdToRowIndex;
  const searchListRef = useRef<VirtualizedListHandle>({
    scrollToBottom: () => listRef.current?.scrollToBottom(),
    scrollToIndex: (index: number) => {
      const id = itemsRef.current[index]?.id;
      const rowIdx =
        id != null ? itemIdToRowIndexRef.current.get(id) : undefined;
      listRef.current?.scrollToIndex(rowIdx ?? index);
    },
  });

  const search = useConversationSearch({
    items,
    containerRef,
    listRef: searchListRef,
  });

  const handleScrollStateChange = useCallback((isAtBottom: boolean) => {
    isAtBottomRef.current = isAtBottom;
    setShowScrollButton(!isAtBottom);
  }, []);

  const scrollToBottom = useCallback(() => {
    listRef.current?.scrollToBottom();
    setShowScrollButton(false);
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden && isAtBottomRef.current) {
        listRef.current?.scrollToBottom();
        setShowScrollButton(false);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  const renderItem = useCallback(
    (item: ConversationItem) => {
      switch (item.type) {
        case "user_message":
          return (
            <UserMessage
              content={item.content}
              attachments={item.attachments}
              timestamp={item.timestamp}
              animate={!initialItemIds.has(item.id)}
              taskId={taskId}
              sourceUrl={
                slackThreadUrl && item.id === firstUserMessageId
                  ? slackThreadUrl
                  : undefined
              }
            />
          );
        case "git_action":
          return <GitActionMessage actionType={item.actionType} />;
        case "skill_button_action":
          return <SkillButtonActionMessage buttonId={item.buttonId} />;
        case "session_update":
          return (
            <SessionUpdateRow
              update={item.update}
              turnContext={item.turnContext}
              thoughtComplete={item.thoughtComplete}
            />
          );
        case "git_action_result":
          return repoPath ? (
            <GitActionResult
              actionType={item.actionType}
              repoPath={repoPath}
              turnId={item.turnId}
            />
          ) : null;
        case "turn_cancelled":
          return <TurnCancelledView interruptReason={item.interruptReason} />;
        case "user_shell_execute":
          return <UserShellExecuteView item={item} />;
        case "queued":
          return (
            <QueuedMessageView
              message={item.message}
              onRemove={
                taskId
                  ? () =>
                      sessionStoreSetters.removeQueuedMessage(
                        taskId,
                        item.message.id,
                      )
                  : undefined
              }
            />
          );
      }
    },
    [repoPath, taskId, slackThreadUrl, firstUserMessageId, initialItemIds],
  );

  const getRowKey = useCallback((row: ThreadRow) => row.id, []);

  const renderRow = useCallback(
    (row: ThreadRow) => {
      if (row.kind === "item") return renderItem(row.item);
      return (
        <ToolCallGroupChip
          summary={row.summary}
          expanded={row.expanded}
          turnComplete={row.turnComplete}
          onToggle={() =>
            sessionViewActions.setGroupOverride(row.id, !row.expanded)
          }
        >
          {row.expanded
            ? row.items.map((it) => {
                // Plain assistant text inside the group has no leading icon, so
                // pad it to line up with the tool titles (the text-next-to-icon
                // column = ToolCallBlock's pl-3 + the icon/gap width). Tool and
                // thought rows already carry their own icon indent.
                const isPlainMessage =
                  it.type === "session_update" &&
                  it.update.sessionUpdate === "agent_message_chunk";
                return (
                  <div
                    key={it.id}
                    className={cn(
                      isPlainMessage ? "pl-5" : undefined,
                      "empty:hidden",
                    )}
                  >
                    {renderItem(it)}
                  </div>
                );
              })
            : null}
        </ToolCallGroupChip>
      );
    },
    [renderItem, sessionViewActions],
  );

  const footer = (
    <div className={compact ? "pb-1" : "pb-16"}>
      <SessionFooter
        task={task}
        isPromptPending={isPromptPending}
        promptStartedAt={promptStartedAt}
        lastGenerationDuration={
          lastTurnInfo?.isComplete
            ? Math.max(0, lastTurnInfo.durationMs - pausedDurationMs)
            : null
        }
        lastStopReason={lastTurnInfo?.stopReason}
        queuedCount={queuedMessages.length}
        hasPendingPermission={pendingPermissionsCount > 0}
        pausedDurationMs={pausedDurationMs}
        isCompacting={isCompacting}
        usage={contextUsage}
        completedToolCallCount={completedToolCallCount}
      />
    </div>
  );

  return (
    <WorkerPoolContextProvider
      poolOptions={diffsPoolOptions}
      highlighterOptions={DIFFS_HIGHLIGHTER_OPTIONS}
    >
      <div ref={containerRef} className="group/thread relative flex-1">
        <div
          id="fullscreen-portal"
          className="pointer-events-none absolute inset-0 z-20"
        />
        {search.open && (
          <ConversationSearchBar
            ref={search.searchBarRef}
            query={search.query}
            currentMatch={search.currentIndex}
            totalMatches={search.totalMatches}
            onQueryChange={search.setQuery}
            onNext={search.next}
            onPrev={search.prev}
            onClose={search.close}
          />
        )}

        <SessionTaskIdProvider taskId={taskId}>
          <VirtualizedList<ThreadRow>
            ref={listRef}
            items={threadRows}
            getItemKey={getRowKey}
            renderItem={renderRow}
            onScrollStateChange={handleScrollStateChange}
            keepMounted={rowKeepMounted}
            className="absolute inset-0 bg-background"
            itemClassName="mx-auto px-2 py-1.5"
            itemStyle={{ maxWidth: CHAT_CONTENT_MAX_WIDTH }}
            footer={footer}
          />
        </SessionTaskIdProvider>
        {showScrollButton && (
          <Box className="absolute right-6 bottom-4 z-10">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-lg"
                    variant="outline"
                    onClick={scrollToBottom}
                  >
                    <ArrowDown size={14} weight="bold" />
                  </Button>
                }
              />
              <TooltipContent>Scroll to bottom</TooltipContent>
            </Tooltip>
          </Box>
        )}
      </div>
    </WorkerPoolContextProvider>
  );
}

const SessionUpdateRow = memo(function SessionUpdateRow({
  update,
  turnContext,
  thoughtComplete,
}: {
  update: RenderItem;
  turnContext: TurnContext;
  thoughtComplete?: boolean;
}) {
  return (
    <SessionUpdateView
      item={update}
      toolCalls={turnContext.toolCalls}
      childItems={turnContext.childItems}
      turnCancelled={turnContext.turnCancelled}
      turnComplete={turnContext.turnComplete}
      thoughtComplete={thoughtComplete}
    />
  );
});

const TurnCancelledView = memo(function TurnCancelledView({
  interruptReason,
}: {
  interruptReason?: string;
}) {
  const message =
    interruptReason === "moving_to_worktree"
      ? "Paused while worktree is focused"
      : "Interrupted by user";

  return (
    <Box className="border-gray-4 border-l-2 py-0.5 pl-3">
      <Flex align="center" gap="2" className="text-gray-9">
        <XCircle size={14} />
        <Text color="gray" className="text-[13px]">
          {message}
        </Text>
      </Flex>
    </Box>
  );
});
