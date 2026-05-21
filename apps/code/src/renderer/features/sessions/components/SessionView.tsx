import { isOtherOption } from "@components/action-selector/constants";
import { PermissionSelector } from "@components/permissions/PermissionSelector";
import {
  PromptInput,
  type EditorHandle as PromptInputHandle,
} from "@features/message-editor/components/PromptInput";
import { useDraftStore } from "@features/message-editor/stores/draftStore";
import { resolveAndAttachDroppedFiles } from "@features/message-editor/utils/persistFile";
import { CHAT_CONTENT_MAX_WIDTH } from "@features/sessions/constants";
import { useSessionForTask } from "@features/sessions/hooks/useSession";
import {
  useAdapterForTask,
  useModeConfigOptionForTask,
  usePendingPermissionsForTask,
  useThoughtLevelConfigOptionForTask,
} from "@features/sessions/stores/sessionStore";
import type { Plan } from "@features/sessions/types";
import { useSettingsStore } from "@features/settings/stores/settingsStore";
import { useIsWorkspaceCloudRun } from "@features/workspace/hooks/useWorkspace";
import { useAutoFocusOnTyping } from "@hooks/useAutoFocusOnTyping";
import { Pause, Spinner, Warning } from "@phosphor-icons/react";
import { Box, Button, ContextMenu, Flex, Text } from "@radix-ui/themes";
import { toast } from "@renderer/utils/toast";
import type { Task, TaskRunStatus } from "@shared/types";
import {
  type AcpMessage,
  isJsonRpcNotification,
  isJsonRpcResponse,
} from "@shared/types/session-events";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSessionService } from "../service/service";
import { flattenSelectOptions } from "../stores/sessionStore";
import {
  useSessionViewActions,
  useShowRawLogs,
} from "../stores/sessionViewStore";
import { CloudInitializingView } from "./CloudInitializingView";
import { ConversationView } from "./ConversationView";
import { DropZoneOverlay } from "./DropZoneOverlay";
import { ModelSelector } from "./ModelSelector";
import { PlanStatusBar } from "./PlanStatusBar";
import { ReasoningLevelSelector } from "./ReasoningLevelSelector";
import { RawLogsView } from "./raw-logs/RawLogsView";

interface SessionViewProps {
  events: AcpMessage[];
  taskId?: string;
  task?: Task;
  isRunning: boolean;
  isPromptPending?: boolean | null;
  promptStartedAt?: number | null;
  onBeforeSubmit?: (text: string, clearEditor: () => void) => boolean;
  onSendPrompt: (text: string) => void;
  onBashCommand?: (command: string) => void;
  onCancelPrompt: () => void;
  repoPath?: string | null;
  cloudBranch?: string | null;
  isSuspended?: boolean;
  onRestoreWorktree?: () => void;
  isRestoring?: boolean;
  hasError?: boolean;
  errorTitle?: string;
  errorMessage?: string;
  onRetry?: () => void;
  onNewSession?: () => void;
  isInitializing?: boolean;
  isCloud?: boolean;
  cloudStatus?: TaskRunStatus | null;
  slackThreadUrl?: string;
  compact?: boolean;
  isActiveSession?: boolean;
  /** Hide the message input and permission UI — log-only view. */
  hideInput?: boolean;
}

const DEFAULT_ERROR_MESSAGE =
  "Failed to resume this session. The working directory may have been deleted. Please start a new session.";

/**
 * When an allow_always permission is granted outside a mode-switch prompt,
 * ratchet the session to the closest "auto-accept edits" preset offered by
 * this adapter's mode catalog. Claude exposes `acceptEdits`; Codex has no
 * exact equivalent, so fall back to `auto`. Returns undefined if neither is
 * available (in which case leave the current mode untouched).
 */
function resolveAllowAlwaysUpgradeMode(
  modeOption: ReturnType<typeof useModeConfigOptionForTask>,
): string | undefined {
  if (modeOption?.type !== "select") return undefined;
  const availableIds = new Set(
    flattenSelectOptions(modeOption.options).map((opt) => opt.value),
  );
  if (availableIds.has("acceptEdits")) return "acceptEdits";
  if (availableIds.has("auto")) return "auto";
  return undefined;
}

export function SessionView({
  events,
  taskId,
  task,
  isRunning,
  isPromptPending = false,
  promptStartedAt,
  onBeforeSubmit,
  onSendPrompt,
  onBashCommand,
  onCancelPrompt,
  repoPath,
  cloudBranch,
  isSuspended = false,
  onRestoreWorktree,
  isRestoring = false,
  hasError = false,
  errorTitle,
  errorMessage = DEFAULT_ERROR_MESSAGE,
  onRetry,
  onNewSession,
  isInitializing = false,
  isCloud = false,
  cloudStatus = null,
  slackThreadUrl,
  compact = false,
  isActiveSession = true,
  hideInput = false,
}: SessionViewProps) {
  const showRawLogs = useShowRawLogs();
  const { setShowRawLogs } = useSessionViewActions();
  const pendingPermissions = usePendingPermissionsForTask(taskId);
  const modeOption = useModeConfigOptionForTask(taskId);
  const thoughtOption = useThoughtLevelConfigOptionForTask(taskId);
  const adapter = useAdapterForTask(taskId);
  const { allowBypassPermissions } = useSettingsStore();
  const currentModeId = modeOption?.currentValue;
  const handoffInProgress =
    useSessionForTask(taskId)?.handoffInProgress ?? false;

  useEffect(() => {
    if (allowBypassPermissions) return;
    // Cloud runs execute in an isolated sandbox where bypass is safe, and the
    // agent's own gate (ALLOW_BYPASS = !IS_ROOT || IS_SANDBOX) already permits
    // it regardless of this local preference. Auto-reverting here would clobber
    // the user's explicit plan-approval choice and strand them in Plan Mode.
    if (isCloud) return;
    const isBypass =
      currentModeId === "bypassPermissions" || currentModeId === "full-access";
    if (isBypass && taskId) {
      getSessionService().setSessionConfigOptionByCategory(
        taskId,
        "mode",
        "default",
      );
    }
  }, [allowBypassPermissions, currentModeId, taskId, isCloud]);

  const handleModeChange = useCallback(
    (nextMode: string) => {
      if (!taskId) return;
      getSessionService().setSessionConfigOptionByCategory(
        taskId,
        "mode",
        nextMode,
      );
    },
    [taskId],
  );

  const handleThoughtChange = useCallback(
    (value: string) => {
      if (!taskId || !thoughtOption) return;
      getSessionService().setSessionConfigOption(
        taskId,
        thoughtOption.id,
        value,
      );
    },
    [taskId, thoughtOption],
  );

  const sessionId = taskId ?? "default";
  const setContext = useDraftStore((s) => s.actions.setContext);
  const requestFocus = useDraftStore((s) => s.actions.requestFocus);

  useEffect(() => {
    setContext(sessionId, {
      taskId,
      repoPath,
      cloudBranch,
      disabled: !isRunning,
      isLoading: !!isPromptPending,
    });
  }, [
    setContext,
    sessionId,
    taskId,
    repoPath,
    cloudBranch,
    isRunning,
    isPromptPending,
  ]);

  const isCloudRun = useIsWorkspaceCloudRun(taskId);

  const latestPlan = useMemo((): Plan | null => {
    let planIndex = -1;
    let plan: Plan | null = null;
    let turnEndResponseIndex = -1;

    for (let i = events.length - 1; i >= 0; i--) {
      const msg = events[i].message;

      if (
        turnEndResponseIndex === -1 &&
        isJsonRpcResponse(msg) &&
        (msg.result as { stopReason?: string })?.stopReason !== undefined
      ) {
        turnEndResponseIndex = i;
      }

      if (
        planIndex === -1 &&
        isJsonRpcNotification(msg) &&
        msg.method === "session/update"
      ) {
        const update = (msg.params as { update?: { sessionUpdate?: string } })
          ?.update;
        if (update?.sessionUpdate === "plan") {
          planIndex = i;
          plan = update as Plan;
        }
      }

      if (planIndex !== -1 && turnEndResponseIndex !== -1) break;
    }

    if (turnEndResponseIndex > planIndex) return null;

    return plan;
  }, [events]);

  const handleSubmit = useCallback(
    (text: string) => {
      if (text.trim()) {
        onSendPrompt(text);
      }
    },
    [onSendPrompt],
  );

  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const editorRef = useRef<PromptInputHandle>(null);
  const dragCounterRef = useRef(0);

  const firstPendingPermission = useMemo(() => {
    const entries = Array.from(pendingPermissions.entries());
    if (entries.length === 0) return null;
    const [toolCallId, permission] = entries[0];
    return { ...permission, toolCallId };
  }, [pendingPermissions]);

  const handlePermissionSelect = useCallback(
    async (
      optionId: string,
      customInput?: string,
      answers?: Record<string, string>,
    ) => {
      if (!firstPendingPermission || !taskId) return;

      const selectedOption = firstPendingPermission.options.find(
        (o) => o.optionId === optionId,
      );
      const isModeSwitch =
        firstPendingPermission.toolCall?.kind === "switch_mode";
      if (selectedOption?.kind === "allow_always" && !isModeSwitch) {
        // Pick the adapter-appropriate "upgrade" mode. Claude exposes
        // acceptEdits; Codex does not — its closest analogue is auto. Resolve
        // against the session's advertised mode catalog so the footer label
        // stays coherent with the dropdown contents.
        const upgradeMode = resolveAllowAlwaysUpgradeMode(modeOption);
        if (upgradeMode) {
          getSessionService().setSessionConfigOptionByCategory(
            taskId,
            "mode",
            upgradeMode,
          );
        }
      }

      if (customInput) {
        if (
          isOtherOption(optionId) ||
          selectedOption?._meta?.customInput === true
        ) {
          await getSessionService().respondToPermission(
            taskId,
            firstPendingPermission.toolCallId,
            optionId,
            customInput,
            answers,
          );
        } else {
          await getSessionService().respondToPermission(
            taskId,
            firstPendingPermission.toolCallId,
            optionId,
            undefined,
            answers,
          );
          onSendPrompt(customInput);
        }
      } else {
        await getSessionService().respondToPermission(
          taskId,
          firstPendingPermission.toolCallId,
          optionId,
          undefined,
          answers,
        );
      }

      requestFocus(sessionId);
    },
    [
      firstPendingPermission,
      taskId,
      onSendPrompt,
      requestFocus,
      sessionId,
      modeOption,
    ],
  );

  const handlePermissionCancel = useCallback(async () => {
    if (!firstPendingPermission || !taskId) return;
    await getSessionService().cancelPermission(
      taskId,
      firstPendingPermission.toolCallId,
    );
    await getSessionService().cancelPrompt(taskId);
    requestFocus(sessionId);
  }, [firstPendingPermission, taskId, requestFocus, sessionId]);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes("Files")) {
      setIsDraggingFile(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDraggingFile(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDraggingFile(false);

    // If dropped on the editor, Tiptap's handleDrop already handled it
    if ((e.target as HTMLElement).closest(".ProseMirror")) return;

    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;

    resolveAndAttachDroppedFiles(files, (a) =>
      editorRef.current?.addAttachment(a),
    )
      .then(() => editorRef.current?.focus())
      .catch(() => toast.error("Failed to attach files"));
  }, []);

  const handlePaneClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;

    const interactiveSelector =
      'button, a, input, textarea, select, [role="button"], [role="link"], [contenteditable="true"], [data-interactive]';
    if (target.closest(interactiveSelector)) {
      return;
    }

    const selection = window.getSelection();
    if (selection && selection.toString().length > 0) {
      return;
    }

    editorRef.current?.focus();
  }, []);

  useAutoFocusOnTyping(editorRef, !isActiveSession);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (
      target.closest('input, textarea, [contenteditable="true"], .ProseMirror')
    ) {
      e.stopPropagation();
    }
  }, []);

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger>
        {showRawLogs ? (
          <Flex
            direction="column"
            height="100%"
            className="relative bg-background"
            onContextMenu={handleContextMenu}
          >
            <RawLogsView
              events={events}
              onClose={() => setShowRawLogs(false)}
            />
          </Flex>
        ) : (
          <Flex
            direction="column"
            height="100%"
            className="relative bg-background"
            onClick={handlePaneClick}
            onContextMenu={handleContextMenu}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          >
            {isSuspended ? (
              <>
                <ConversationView
                  events={events}
                  isPromptPending={isPromptPending}
                  promptStartedAt={promptStartedAt}
                  repoPath={repoPath}
                  taskId={taskId}
                  task={task}
                  slackThreadUrl={slackThreadUrl}
                />
                <Box className="border-gray-4 border-t">
                  <Box
                    className="mx-auto p-2"
                    style={{ maxWidth: CHAT_CONTENT_MAX_WIDTH }}
                  >
                    <Flex
                      align="center"
                      justify="between"
                      gap="3"
                      py="2"
                      px="3"
                      className="rounded-2 bg-gray-3"
                    >
                      <Flex align="center" gap="2">
                        <Pause
                          size={14}
                          weight="duotone"
                          color="var(--gray-11)"
                        />
                        <Text className="font-medium text-[13px]">
                          Worktree suspended
                        </Text>
                        <Text color="gray" className="text-[13px]">
                          Worktree was removed to save disk space
                        </Text>
                      </Flex>
                      {onRestoreWorktree && (
                        <Button
                          variant="outline"
                          size="1"
                          onClick={onRestoreWorktree}
                          disabled={isRestoring}
                        >
                          {isRestoring ? (
                            <>
                              <Spinner size={14} className="animate-spin" />
                              Restoring...
                            </>
                          ) : (
                            "Restore worktree"
                          )}
                        </Button>
                      )}
                    </Flex>
                  </Box>
                </Box>
              </>
            ) : isInitializing ? (
              isCloud ? (
                <CloudInitializingView cloudStatus={cloudStatus} />
              ) : (
                <Flex
                  align="center"
                  justify="center"
                  className="absolute inset-0 bg-background"
                >
                  <Spinner size={32} className="animate-spin text-gray-9" />
                </Flex>
              )
            ) : (
              <>
                <DropZoneOverlay isVisible={isDraggingFile} />
                <ConversationView
                  events={events}
                  isPromptPending={isPromptPending}
                  promptStartedAt={promptStartedAt}
                  repoPath={repoPath}
                  taskId={taskId}
                  task={task}
                  slackThreadUrl={slackThreadUrl}
                  compact={compact}
                />

                <PlanStatusBar plan={latestPlan} />

                {hasError ? (
                  <Flex
                    align="center"
                    justify="center"
                    direction="column"
                    gap="2"
                    className="absolute inset-0 bg-background"
                  >
                    <Warning size={32} weight="duotone" color="var(--red-9)" />
                    {errorTitle && (
                      <Text
                        align="center"
                        color="red"
                        className="font-bold text-base"
                      >
                        {errorTitle}
                      </Text>
                    )}
                    <Text
                      align="center"
                      color={errorTitle ? "gray" : "red"}
                      className={`max-w-md px-4 ${errorTitle ? "text-sm" : "font-medium text-base"}`}
                    >
                      {errorMessage}
                    </Text>
                    <Flex gap="2" mt="2">
                      {onRetry && (
                        <Button variant="soft" size="2" onClick={onRetry}>
                          Retry
                        </Button>
                      )}
                      {onNewSession && (
                        <Button
                          variant="soft"
                          size="2"
                          color="green"
                          onClick={onNewSession}
                        >
                          New Session
                        </Button>
                      )}
                    </Flex>
                  </Flex>
                ) : hideInput ? null : firstPendingPermission ? (
                  <Box className="max-h-1/2 min-h-0 overflow-y-auto border-gray-4 border-t">
                    <Box
                      className={compact ? "p-1" : "mx-auto p-2"}
                      style={
                        compact
                          ? undefined
                          : { maxWidth: CHAT_CONTENT_MAX_WIDTH }
                      }
                    >
                      <PermissionSelector
                        toolCall={firstPendingPermission.toolCall}
                        options={firstPendingPermission.options}
                        onSelect={handlePermissionSelect}
                        onCancel={handlePermissionCancel}
                      />
                    </Box>
                  </Box>
                ) : (
                  <Box className="relative border-gray-4 border-t">
                    <Box
                      className={`absolute inset-0 flex min-h-[66px] items-center justify-center gap-2 transition-opacity duration-200 ${
                        isRunning
                          ? "pointer-events-none opacity-0"
                          : "opacity-100"
                      }`}
                    >
                      <Spinner size={28} className="animate-spin text-gray-9" />
                      <Text color="gray" className="text-base">
                        Connecting to agent...
                      </Text>
                    </Box>
                    <Box
                      className={`transition-all duration-300 ease-out ${
                        isRunning
                          ? "translate-y-0 opacity-100"
                          : "pointer-events-none translate-y-4 opacity-0"
                      }`}
                    >
                      <Box
                        className={compact ? "p-1" : "mx-auto p-2"}
                        style={
                          compact
                            ? undefined
                            : { maxWidth: CHAT_CONTENT_MAX_WIDTH }
                        }
                      >
                        <PromptInput
                          ref={editorRef}
                          sessionId={sessionId}
                          placeholder="Type a message... @ to mention files, ! for bash mode, / for skills"
                          disabled={!isRunning && !handoffInProgress}
                          submitDisabledExternal={handoffInProgress}
                          isLoading={!!isPromptPending}
                          isActiveSession={isActiveSession}
                          taskId={taskId}
                          repoPath={repoPath}
                          modeOption={modeOption}
                          onModeChange={
                            modeOption ? handleModeChange : undefined
                          }
                          allowBypassPermissions={allowBypassPermissions}
                          enableBashMode={!isCloudRun}
                          modelSelector={
                            <ModelSelector
                              taskId={taskId}
                              disabled={!isRunning}
                            />
                          }
                          reasoningSelector={
                            thoughtOption ? (
                              <ReasoningLevelSelector
                                thoughtOption={thoughtOption}
                                adapter={adapter}
                                onChange={handleThoughtChange}
                                disabled={!isRunning}
                              />
                            ) : null
                          }
                          onBeforeSubmit={onBeforeSubmit}
                          onSubmit={handleSubmit}
                          onBashCommand={onBashCommand}
                          onCancel={onCancelPrompt}
                        />
                      </Box>
                    </Box>
                  </Box>
                )}
              </>
            )}
          </Flex>
        )}
      </ContextMenu.Trigger>
      <ContextMenu.Content size="1">
        <ContextMenu.Item
          onSelect={() => {
            const text = window.getSelection()?.toString();
            if (text) {
              navigator.clipboard.writeText(text);
            }
          }}
        >
          Copy
        </ContextMenu.Item>
        <ContextMenu.Separator />
        <ContextMenu.Item onSelect={() => setShowRawLogs(!showRawLogs)}>
          {showRawLogs ? "Back to conversation" : "Show raw logs"}
        </ContextMenu.Item>
      </ContextMenu.Content>
    </ContextMenu.Root>
  );
}
