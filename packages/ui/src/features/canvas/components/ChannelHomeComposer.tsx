import { isValidConfigValue } from "@posthog/core/task-detail/configOptions";
import type { Task } from "@posthog/shared/domain-types";
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { useConnectivity } from "../../../hooks/useConnectivity";
import { PromptInput } from "../../message-editor/components/PromptInput";
import { useDraftStore } from "../../message-editor/draftStore";
import type { EditorHandle } from "../../message-editor/types";
import { ReasoningLevelSelector } from "../../sessions/components/ReasoningLevelSelector";
import { UnifiedModelSelector } from "../../sessions/components/UnifiedModelSelector";
import { getCurrentModeFromConfigOptions } from "../../sessions/sessionStore";
import {
  type AgentAdapter,
  useSettingsStore,
} from "../../settings/settingsStore";
import {
  type WorkspaceMode,
  WorkspaceModeSelect,
} from "../../task-detail/components/WorkspaceModeSelect";
import { usePreviewConfig } from "../../task-detail/hooks/usePreviewConfig";
import { useTaskCreation } from "../../task-detail/hooks/useTaskCreation";

export interface ChannelHomeComposerHandle {
  /** Drop a starter prompt into the editor and apply its mode, if any. */
  applySuggestion: (prompt: string, mode?: string) => void;
}

interface ChannelHomeComposerProps {
  channelId: string;
  channelName?: string;
  /** Channel CONTEXT.md, attached to the created task as background. */
  channelContext?: string;
  onTaskCreated: (task: Task) => void;
}

// The prompt box at the bottom of a channel's homepage. A trimmed-down sibling
// of TaskInput: it reuses the same task-creation pipeline (model/mode/reasoning
// preview config + useTaskCreation) but drops the repo/branch pickers — channel
// tasks run repo-less and the agent attaches a repo lazily if it needs one. The
// starter-prompt suggestions render in the parent above the box; this owns the
// local/cloud selector.
export const ChannelHomeComposer = forwardRef<
  ChannelHomeComposerHandle,
  ChannelHomeComposerProps
>(function ChannelHomeComposer(
  { channelId, channelName, channelContext, onTaskCreated },
  ref,
) {
  const sessionId = `channel-home:${channelId}`;
  const editorRef = useRef<EditorHandle>(null);
  const [editorIsEmpty, setEditorIsEmpty] = useState(true);
  const { isOnline } = useConnectivity();

  const {
    lastUsedAdapter,
    setLastUsedAdapter,
    lastUsedWorkspaceMode,
    setLastUsedWorkspaceMode,
    setLastUsedLocalWorkspaceMode,
    allowBypassPermissions,
    defaultInitialTaskMode,
    lastUsedInitialTaskMode,
    setLastUsedReasoningEffort,
    setLastUsedModel,
  } = useSettingsStore();

  const adapter = lastUsedAdapter;
  const setAdapter = useCallback(
    (next: AgentAdapter) => setLastUsedAdapter(next),
    [setLastUsedAdapter],
  );

  // Repo-less channel tasks only run local or cloud (worktree needs a repo), so
  // collapse any lingering worktree preference down to local for the initial pick.
  const [workspaceMode, setWorkspaceModeState] = useState<WorkspaceMode>(
    lastUsedWorkspaceMode === "cloud" ? "cloud" : "local",
  );
  const [selectedCloudEnvId, setSelectedCloudEnvId] = useState<string | null>(
    null,
  );
  const setWorkspaceMode = useCallback(
    (mode: WorkspaceMode) => {
      setWorkspaceModeState(mode);
      setLastUsedWorkspaceMode(mode);
      if (mode !== "cloud") setLastUsedLocalWorkspaceMode(mode);
    },
    [setLastUsedWorkspaceMode, setLastUsedLocalWorkspaceMode],
  );

  const { modeOption, modelOption, thoughtOption, isLoading, setConfigOption } =
    usePreviewConfig(adapter);

  const currentModel =
    modelOption?.type === "select" ? modelOption.currentValue : undefined;
  const adapterDefault = adapter === "codex" ? "auto" : "plan";
  const modeFallback =
    defaultInitialTaskMode === "last_used" &&
    lastUsedInitialTaskMode &&
    isValidConfigValue(modeOption, lastUsedInitialTaskMode)
      ? lastUsedInitialTaskMode
      : adapterDefault;
  const currentExecutionMode =
    getCurrentModeFromConfigOptions(modeOption ? [modeOption] : undefined) ??
    modeFallback;
  const currentReasoningLevel =
    thoughtOption?.type === "select" ? thoughtOption.currentValue : undefined;

  const { isCreatingTask, canSubmit, handleSubmit } = useTaskCreation({
    editorRef,
    sessionId,
    selectedDirectory: "",
    workspaceMode,
    sandboxEnvironmentId:
      workspaceMode === "cloud" && selectedCloudEnvId
        ? selectedCloudEnvId
        : undefined,
    editorIsEmpty,
    adapter,
    executionMode: currentExecutionMode,
    model: currentModel,
    reasoningLevel: currentReasoningLevel,
    allowNoRepo: true,
    channelContext,
    channelName,
    onTaskCreated,
  });

  const handleModeChange = useCallback(
    (value: string) => {
      if (modeOption) setConfigOption(modeOption.id, value);
    },
    [modeOption, setConfigOption],
  );
  const handleModelChange = useCallback(
    (value: string) => {
      if (modelOption) {
        setConfigOption(modelOption.id, value);
        setLastUsedModel(value);
      }
    },
    [modelOption, setConfigOption, setLastUsedModel],
  );
  const handleThoughtChange = useCallback(
    (value: string) => {
      if (thoughtOption) {
        setConfigOption(thoughtOption.id, value);
        setLastUsedReasoningEffort(value);
      }
    },
    [thoughtOption, setConfigOption, setLastUsedReasoningEffort],
  );

  useImperativeHandle(
    ref,
    () => ({
      applySuggestion: (prompt: string, mode?: string) => {
        // Pending content (not setContent) preserves the multi-line template's
        // line breaks and focuses at the end; mirrors the new-task screen.
        useDraftStore.getState().actions.setPendingContent(sessionId, {
          segments: [{ type: "text", text: prompt }],
        });
        if (mode && isValidConfigValue(modeOption, mode)) {
          setConfigOption(modeOption.id, mode);
        }
      },
    }),
    [sessionId, modeOption, setConfigOption],
  );

  const hints = ["@ to add files", "/ for skills"].join(", ");

  return (
    <div className="flex w-full flex-col">
      <div className="mb-2 flex items-center gap-2">
        <WorkspaceModeSelect
          value={workspaceMode}
          onChange={setWorkspaceMode}
          overrideModes={["local", "cloud"]}
          selectedCloudEnvironmentId={selectedCloudEnvId}
          onCloudEnvironmentChange={setSelectedCloudEnvId}
          size="1"
          disabled={isCreatingTask}
        />
      </div>

      <PromptInput
        ref={editorRef}
        sessionId={sessionId}
        placeholder={`What do you want to ship? ${hints}`}
        editorHeight="large"
        disabled={isCreatingTask}
        isLoading={isCreatingTask}
        autoFocus
        clearOnSubmit={false}
        submitDisabledExternal={
          !canSubmit || isCreatingTask || !isOnline || isLoading
        }
        modeOption={modeOption}
        onModeChange={handleModeChange}
        allowBypassPermissions={allowBypassPermissions}
        enableCommands
        enableBashMode={false}
        modelSelector={
          <UnifiedModelSelector
            modelOption={modelOption}
            adapter={adapter ?? "claude"}
            onAdapterChange={setAdapter}
            disabled={isCreatingTask}
            isConnecting={isLoading}
            onModelChange={handleModelChange}
          />
        }
        reasoningSelector={
          !isLoading && (
            <ReasoningLevelSelector
              thoughtOption={thoughtOption}
              adapter={adapter}
              onChange={handleThoughtChange}
              disabled={isCreatingTask}
            />
          )
        }
        onEmptyChange={setEditorIsEmpty}
        onSubmitClick={handleSubmit}
        onSubmit={() => {
          if (canSubmit) handleSubmit();
        }}
      />
    </div>
  );
});
