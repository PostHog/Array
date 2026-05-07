import { CHAT_CONTENT_MAX_WIDTH } from "@features/sessions/constants";
import { useContextUsage } from "@features/sessions/hooks/useContextUsage";
import { useConversationSearch } from "@features/sessions/hooks/useConversationSearch";
import {
  sessionStoreSetters,
  useOptimisticItemsForTask,
  usePendingPermissionsForTask,
  useQueuedMessagesForTask,
  useSessionForTask,
} from "@features/sessions/stores/sessionStore";
import { useSettingsStore } from "@features/settings/stores/settingsStore";
import { SkillButtonActionMessage } from "@features/skill-buttons/components/SkillButtonActionMessage";
import { ArrowDown, XCircle } from "@phosphor-icons/react";
import { WorkerPoolContextProvider } from "@pierre/diffs/react";
import WorkerUrl from "@pierre/diffs/worker/worker.js?worker&url";
import { Box, Button, Flex, Text } from "@radix-ui/themes";
import type { Task } from "@shared/types";
import type { AcpMessage } from "@shared/types/session-events";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildConversationItems,
  type ConversationItem,
  type TurnContext,
} from "./buildConversationItems";
import { ConversationSearchBar } from "./ConversationSearchBar";
import { GitActionMessage } from "./GitActionMessage";
import { GitActionResult } from "./GitActionResult";
import { mergeConversationItems } from "./mergeConversationItems";
import { SessionFooter } from "./SessionFooter";
import { QueuedMessageView } from "./session-update/QueuedMessageView";
import {
  type RenderItem,
  SessionUpdateView,
} from "./session-update/SessionUpdateView";
import { UserMessage } from "./session-update/UserMessage";
import { UserShellExecuteView } from "./session-update/UserShellExecuteView";
import { VirtualizedList, type VirtualizedListHandle } from "./VirtualizedList";

function diffsWorkerFactory(): Worker {
  return new Worker(WorkerUrl, { type: "module" });
}

const DIFFS_POOL_OPTIONS = {
  workerFactory: diffsWorkerFactory,
  totalASTLRUCacheSize: 200,
};

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
  const listRef = useRef<VirtualizedListHandle>(null);
  const isAtBottomRef = useRef(true);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const debugLogsCloudRuns = useSettingsStore((s) => s.debugLogsCloudRuns);
  const showDebugLogs = debugLogsCloudRuns;
  const contextUsage = useContextUsage(events);

  const {
    items: conversationItems,
    lastTurnInfo,
    isCompacting,
  } = useMemo(
    () =>
      buildConversationItems(events, isPromptPending, {
        showDebugLogs,
      }),
    [events, isPromptPending, showDebugLogs],
  );

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

  // Keep MCP App tool call items mounted so their iframes and bridges
  // survive scrolling out of the virtualized viewport.
  const mcpAppIndices = useMemo(() => {
    const indices: number[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type !== "session_update") continue;
      const update = item.update;
      if (!("_meta" in update)) continue;
      const meta = update._meta as
        | { claudeCode?: { toolName?: string } }
        | undefined;
      if (meta?.claudeCode?.toolName?.startsWith("mcp__")) {
        indices.push(i);
      }
    }
    return indices;
  }, [items]);

  const containerRef = useRef<HTMLDivElement>(null);
  const search = useConversationSearch({ items, containerRef, listRef });

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

  const getItemKey = useCallback((item: ConversationItem) => item.id, []);

  return (
    <WorkerPoolContextProvider
      poolOptions={DIFFS_POOL_OPTIONS}
      highlighterOptions={DIFFS_HIGHLIGHTER_OPTIONS}
    >
      <div ref={containerRef} className="relative flex-1">
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

        <VirtualizedList
          ref={listRef}
          items={items}
          getItemKey={getItemKey}
          renderItem={renderItem}
          onScrollStateChange={handleScrollStateChange}
          keepMounted={mcpAppIndices}
          className="absolute inset-0 bg-background"
          itemClassName="mx-auto px-2 py-1.5"
          itemStyle={{ maxWidth: CHAT_CONTENT_MAX_WIDTH }}
          footer={
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
              />
            </div>
          }
        />
        {showScrollButton && (
          <Box className="absolute right-4 bottom-4 z-10">
            <Button size="1" variant="solid" onClick={scrollToBottom}>
              <ArrowDown size={14} weight="bold" />
              Scroll to bottom
            </Button>
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
