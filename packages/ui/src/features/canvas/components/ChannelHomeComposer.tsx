import { CaretDownIcon } from "@phosphor-icons/react";
import { isValidConfigValue } from "@posthog/core/task-detail/configOptions";
import { cn } from "@posthog/quill";
import type { Task } from "@posthog/shared/domain-types";
import { CHANNEL_TASK_SUGGESTIONS } from "@posthog/ui/features/canvas/channelTaskSuggestions";
import { SuggestedPromptCard } from "@posthog/ui/features/task-detail/components/SuggestedPromptCard";
import { Text } from "@radix-ui/themes";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useRef, useState } from "react";
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
import { usePreviewConfig } from "../../task-detail/hooks/usePreviewConfig";
import { useTaskCreation } from "../../task-detail/hooks/useTaskCreation";

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
// starter-prompt suggestions live here too, hidden behind a "See suggestions"
// toggle below the box.
export function ChannelHomeComposer({
  channelId,
  channelName,
  channelContext,
  onTaskCreated,
}: ChannelHomeComposerProps) {
  const sessionId = `channel-home:${channelId}`;
  const editorRef = useRef<EditorHandle>(null);
  const [editorIsEmpty, setEditorIsEmpty] = useState(true);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const { isOnline } = useConnectivity();

  const {
    lastUsedAdapter,
    setLastUsedAdapter,
    lastUsedWorkspaceMode,
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

  // Channels are a repo-less chat box: keep the user's last-used workspace mode
  // but never require a repo (allowNoRepo), matching the new-task screen.
  const workspaceMode = lastUsedWorkspaceMode || "local";

  const { isCreatingTask, canSubmit, handleSubmit } = useTaskCreation({
    editorRef,
    sessionId,
    selectedDirectory: "",
    workspaceMode,
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

  const handleSuggestionSelect = useCallback(
    (prompt: string, mode?: string) => {
      // Pending content (not setContent) preserves the multi-line template's
      // line breaks and focuses at the end; mirrors the new-task screen.
      useDraftStore.getState().actions.setPendingContent(sessionId, {
        segments: [{ type: "text", text: prompt }],
      });
      if (mode && isValidConfigValue(modeOption, mode)) {
        setConfigOption(modeOption.id, mode);
      }
      setSuggestionsOpen(false);
    },
    [sessionId, modeOption, setConfigOption],
  );

  const hints = ["@ to add files", "/ for skills"].join(", ");

  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col px-4 pb-4">
      <AnimatePresence initial={false}>
        {suggestionsOpen && (
          <motion.div
            key="suggestions"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="mb-3 flex flex-col gap-2 pb-1">
              <Text size="1" weight="medium" className="px-1 text-(--gray-11)">
                Suggestions
              </Text>
              <div className="grid grid-cols-2 gap-2">
                {CHANNEL_TASK_SUGGESTIONS.map((suggestion) => (
                  <SuggestedPromptCard
                    key={suggestion.label}
                    suggestion={suggestion}
                    onSelect={() =>
                      handleSuggestionSelect(suggestion.prompt, suggestion.mode)
                    }
                  />
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

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

      <button
        type="button"
        onClick={() => setSuggestionsOpen((v) => !v)}
        className="mt-2 inline-flex items-center gap-1 self-center text-[12px] text-gray-10 transition-colors hover:text-gray-12"
      >
        {suggestionsOpen ? "Hide suggestions" : "See suggestions"}
        <CaretDownIcon
          size={12}
          className={cn(
            "transition-transform",
            suggestionsOpen && "rotate-180",
          )}
        />
      </button>
    </div>
  );
}
