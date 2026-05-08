import { DotPatternBackground } from "@components/DotPatternBackground";
import { EnvironmentSelector } from "@features/environments/components/EnvironmentSelector";
import { FolderPicker } from "@features/folder-picker/components/FolderPicker";
import { GitHubRepoPicker } from "@features/folder-picker/components/GitHubRepoPicker";
import { useFolders } from "@features/folders/hooks/useFolders";
import { BranchSelector } from "@features/git-interaction/components/BranchSelector";
import { GitBranchDialog } from "@features/git-interaction/components/GitInteractionDialogs";
import { useGitQueries } from "@features/git-interaction/hooks/useGitQueries";
import { useGitInteractionStore } from "@features/git-interaction/state/gitInteractionStore";
import {
  createBranch,
  getBranchNameInputState,
} from "@features/git-interaction/utils/branchCreation";
import { useInboxReportSelectionStore } from "@features/inbox/stores/inboxReportSelectionStore";
import { PromptHistoryDialog } from "@features/message-editor/components/PromptHistoryDialog";
import { PromptInput } from "@features/message-editor/components/PromptInput";
import { useTaskInputHistoryStore } from "@features/message-editor/stores/taskInputHistoryStore";
import type { EditorHandle } from "@features/message-editor/types";
import { resolveAndAttachDroppedFiles } from "@features/message-editor/utils/persistFile";
import { DropZoneOverlay } from "@features/sessions/components/DropZoneOverlay";
import { ReasoningLevelSelector } from "@features/sessions/components/ReasoningLevelSelector";
import { UnifiedModelSelector } from "@features/sessions/components/UnifiedModelSelector";
import { getCurrentModeFromConfigOptions } from "@features/sessions/stores/sessionStore";
import type { AgentAdapter } from "@features/settings/stores/settingsStore";
import { useSettingsStore } from "@features/settings/stores/settingsStore";
import { useAutoFocusOnTyping } from "@hooks/useAutoFocusOnTyping";
import { useConnectivity } from "@hooks/useConnectivity";
import {
  useUserGithubBranches,
  useUserGithubRepositories,
  useUserRepositoryIntegration,
} from "@hooks/useIntegrations";
import { X } from "@phosphor-icons/react";
import { ButtonGroup } from "@posthog/quill";
import { Flex, Text, Tooltip } from "@radix-ui/themes";
import { useAuthStore } from "@renderer/features/auth/stores/authStore";
import { useDraftStore } from "@renderer/features/message-editor/stores/draftStore";
import { trpcClient, useTRPC } from "@renderer/trpc/client";
import { toast } from "@renderer/utils/toast";
import {
  type TaskInputReportAssociation,
  useNavigationStore,
} from "@stores/navigationStore";
import { useQuery } from "@tanstack/react-query";
import { FOCUSABLE_SELECTOR } from "@utils/overlay";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePreviewConfig } from "../hooks/usePreviewConfig";
import { useTaskCreation } from "../hooks/useTaskCreation";
import { CloudGithubMissingNotice } from "./CloudGithubMissingNotice";
import { type WorkspaceMode, WorkspaceModeSelect } from "./WorkspaceModeSelect";

interface TaskInputProps {
  sessionId?: string;
  onTaskCreated?: (task: import("@shared/types").Task) => void;
  initialPrompt?: string;
  initialPromptKey?: string;
  initialCloudRepository?: string;
  reportAssociation?: TaskInputReportAssociation;
}

export function TaskInput({
  sessionId = "task-input",
  onTaskCreated,
  initialPrompt,
  initialPromptKey,
  initialCloudRepository,
  reportAssociation,
}: TaskInputProps = {}) {
  const { cloudRegion } = useAuthStore();
  const trpcReact = useTRPC();
  const { view, clearTaskInputReportAssociation, navigateToInbox } =
    useNavigationStore();
  const setSelectedReportIds = useInboxReportSelectionStore(
    (s) => s.setSelectedReportIds,
  );
  const { data: mostRecentRepo } = useQuery(
    trpcReact.folders.getMostRecentlyAccessedRepository.queryOptions(),
  );
  const {
    lastUsedLocalWorkspaceMode,
    setLastUsedLocalWorkspaceMode,
    lastUsedWorkspaceMode,
    setLastUsedWorkspaceMode,
    lastUsedAdapter,
    setLastUsedAdapter,
    lastUsedCloudRepository,
    setLastUsedCloudRepository,
    allowBypassPermissions,
    setLastUsedEnvironment,
    getLastUsedEnvironment,
    defaultInitialTaskMode,
    lastUsedInitialTaskMode,
    setLastUsedReasoningEffort,
  } = useSettingsStore();

  const editorRef = useRef<EditorHandle>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonGroupRef = useRef<HTMLDivElement>(null);
  const dragCounterRef = useRef(0);
  const reportInputHadContentRef = useRef(false);

  const [editorIsEmpty, setEditorIsEmpty] = useState(true);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [isCreatingBranch, setIsCreatingBranch] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const [cloudRepoSearchQuery, setCloudRepoSearchQuery] = useState("");
  const [isCloudRepoPickerOpen, setIsCloudRepoPickerOpen] = useState(false);
  const [cloudBranchSearchQuery, setCloudBranchSearchQuery] = useState("");
  const [isCloudBranchPickerOpen, setIsCloudBranchPickerOpen] = useState(false);
  const [selectedEnvironment, setSelectedEnvironmentRaw] = useState<
    string | null
  >(null);
  const [selectedCloudEnvId, setSelectedCloudEnvId] = useState<string | null>(
    null,
  );
  const [activeReportAssociation, setActiveReportAssociation] = useState(
    reportAssociation ?? null,
  );

  const [selectedDirectory, setSelectedDirectory] = useState("");
  const adapter = lastUsedAdapter;
  const prefillRequestKey = initialPromptKey ?? initialPrompt;

  useEffect(() => {
    if (!initialPrompt || !prefillRequestKey) return;
    useDraftStore.getState().actions.setPendingContent(sessionId, {
      segments: [{ type: "text", text: initialPrompt }],
    });
  }, [initialPrompt, prefillRequestKey, sessionId]);

  useEffect(() => {
    reportInputHadContentRef.current = false;
    setActiveReportAssociation(reportAssociation ?? null);
  }, [reportAssociation]);

  const handleDismissReportAssociation = useCallback(() => {
    reportInputHadContentRef.current = false;
    setActiveReportAssociation(null);
    clearTaskInputReportAssociation();
  }, [clearTaskInputReportAssociation]);

  const handleEditorEmptyChange = useCallback(
    (isEmpty: boolean) => {
      setEditorIsEmpty(isEmpty);

      if (!activeReportAssociation) return;
      if (!isEmpty) {
        reportInputHadContentRef.current = true;
        return;
      }
      if (!reportInputHadContentRef.current) return;

      reportInputHadContentRef.current = false;
      setActiveReportAssociation(null);
      clearTaskInputReportAssociation();
    },
    [activeReportAssociation, clearTaskInputReportAssociation],
  );

  const handleOpenAssociatedReport = useCallback(() => {
    if (!activeReportAssociation) return;
    navigateToInbox();
    setSelectedReportIds([activeReportAssociation.reportId]);
  }, [activeReportAssociation, navigateToInbox, setSelectedReportIds]);

  useEffect(() => {
    if (!selectedDirectory && mostRecentRepo?.path) {
      setSelectedDirectory(mostRecentRepo.path);
    }
  }, [mostRecentRepo?.path, selectedDirectory]);

  const setAdapter = (newAdapter: AgentAdapter) =>
    setLastUsedAdapter(newAdapter);

  const {
    repositories,
    getInstallationIdForRepo,
    getUserIntegrationIdForRepo,
    isLoadingRepos,
    isRefreshingRepos,
    refreshRepositories,
    hasGithubIntegration,
  } = useUserRepositoryIntegration();

  // Stay optimistic while the integration list resolves to avoid flicker.
  const cloudAvailable = isLoadingRepos || hasGithubIntegration;
  const [workspaceMode, setWorkspaceModeState] = useState<WorkspaceMode>(() => {
    if (initialCloudRepository) return "cloud";
    if (!cloudAvailable && lastUsedWorkspaceMode === "cloud") {
      return lastUsedLocalWorkspaceMode;
    }
    return lastUsedWorkspaceMode || "local";
  });

  const setWorkspaceMode = (mode: WorkspaceMode) => {
    setWorkspaceModeState(mode);
    setLastUsedWorkspaceMode(mode);
    if (mode !== "cloud") {
      setLastUsedLocalWorkspaceMode(mode);
    }
  };

  useEffect(() => {
    if (workspaceMode === "cloud" && !cloudAvailable) {
      setWorkspaceModeState(lastUsedLocalWorkspaceMode);
    }
  }, [workspaceMode, cloudAvailable, lastUsedLocalWorkspaceMode]);
  const {
    repositories: visibleCloudRepositories,
    isPending: cloudRepositoriesLoading,
    hasMore: cloudRepositoriesHasMore,
    loadMore: loadMoreCloudRepositories,
  } = useUserGithubRepositories(cloudRepoSearchQuery, isCloudRepoPickerOpen);
  const [selectedRepository, setSelectedRepository] = useState<string | null>(
    () =>
      initialCloudRepository?.toLowerCase() ??
      lastUsedCloudRepository?.toLowerCase() ??
      null,
  );
  const selectedCloudRepository = useMemo(() => {
    if (!selectedRepository) return null;
    const lower = selectedRepository.toLowerCase();
    return repositories.includes(lower) ? lower : null;
  }, [selectedRepository, repositories]);
  const { currentBranch, branchLoading, defaultBranch } =
    useGitQueries(selectedDirectory);

  const selectedGithubUserIntegrationId = selectedCloudRepository
    ? getUserIntegrationIdForRepo(selectedCloudRepository)
    : undefined;
  const selectedInstallationId = selectedCloudRepository
    ? getInstallationIdForRepo(selectedCloudRepository)
    : undefined;

  const {
    data: cloudBranchData,
    isPending: cloudBranchesLoading,
    isRefreshing: cloudBranchesRefreshing,
    isFetchingMore: cloudBranchesFetchingMore,
    hasMore: cloudBranchesHasMore,
    loadMore: loadMoreCloudBranches,
    refresh: refreshCloudBranches,
  } = useUserGithubBranches(
    selectedInstallationId,
    selectedCloudRepository,
    cloudBranchSearchQuery,
    isCloudBranchPickerOpen,
  );
  const cloudBranches = cloudBranchData?.branches;
  const cloudDefaultBranch = cloudBranchData?.defaultBranch ?? null;

  const {
    branchOpen,
    branchName: newBranchName,
    branchError,
    actions: gitActions,
  } = useGitInteractionStore();

  const handleNewBranchNameChange = useCallback(
    (value: string) => {
      const { sanitized, error } = getBranchNameInputState(value);
      gitActions.setBranchName(sanitized);
      gitActions.setBranchError(error);
    },
    [gitActions],
  );

  const handleCreateBranch = useCallback(async () => {
    setIsCreatingBranch(true);

    try {
      const result = await createBranch({
        repoPath: selectedDirectory || undefined,
        rawBranchName: newBranchName,
      });
      if (!result.success) {
        gitActions.setBranchError(result.error);
        return;
      }

      setSelectedBranch(result.branchName);
      gitActions.closeBranch();
    } finally {
      setIsCreatingBranch(false);
    }
  }, [selectedDirectory, newBranchName, gitActions]);

  const handleRepositorySelect = useCallback(
    (repo: string | null) => {
      if (!repo) {
        setSelectedRepository(null);
        setLastUsedCloudRepository(null);
        return;
      }

      const normalizedRepo = repo.toLowerCase();
      setSelectedRepository(normalizedRepo);
      setLastUsedCloudRepository(normalizedRepo);
    },
    [setLastUsedCloudRepository],
  );

  useEffect(() => {
    if (!initialCloudRepository) return;
    setWorkspaceModeState("cloud");
    setSelectedRepository(initialCloudRepository.toLowerCase());
  }, [initialCloudRepository]);

  const handleRefreshRepositories = useCallback(() => {
    void refreshRepositories().catch((error) => {
      toast.error("Failed to refresh repositories", {
        description:
          error instanceof Error ? error.message : "Please try again.",
      });
    });
  }, [refreshRepositories]);

  const handleRefreshBranches = useCallback(() => {
    void refreshCloudBranches().catch((error) => {
      toast.error("Failed to refresh branches", {
        description:
          error instanceof Error ? error.message : "Please try again.",
      });
    });
  }, [refreshCloudBranches]);

  const handleCloudBranchPickerOpen = useCallback(() => {
    setIsCloudBranchPickerOpen(true);
  }, []);

  const handleCloudRepoPickerOpenChange = useCallback((open: boolean) => {
    setIsCloudRepoPickerOpen(open);
    if (!open) {
      setCloudRepoSearchQuery("");
    }
  }, []);

  const handleCloudRepoSearchChange = useCallback((value: string) => {
    setCloudRepoSearchQuery(value);
  }, []);

  const handleLoadMoreCloudRepositories = useCallback(() => {
    loadMoreCloudRepositories();
  }, [loadMoreCloudRepositories]);

  const handleCloudBranchPickerClose = useCallback(() => {
    setIsCloudBranchPickerOpen(false);
    setCloudBranchSearchQuery("");
  }, []);

  const handleCloudBranchSearchChange = useCallback((value: string) => {
    setCloudBranchSearchQuery(value);
  }, []);

  const handleLoadMoreCloudBranches = useCallback(() => {
    loadMoreCloudBranches();
  }, [loadMoreCloudBranches]);

  const {
    modeOption,
    modelOption,
    thoughtOption,
    isLoading: isPreviewLoading,
    setConfigOption,
  } = usePreviewConfig(adapter);

  const { folders } = useFolders();

  useEffect(() => {
    if (selectedRepository || !lastUsedCloudRepository) {
      return;
    }

    setSelectedRepository(lastUsedCloudRepository.toLowerCase());
  }, [lastUsedCloudRepository, selectedRepository]);

  useEffect(() => {
    // Clear `selectedRepository` only when the list has actually loaded AND the
    // selection is missing from it — i.e. the repo was removed from the user's
    // integrations. Bail out when `repositories` is empty: that can happen
    // transiently after `isLoadingRepos` flips false but before the
    // per-integration queries have produced data, and clearing here would
    // wipe out a freshly-supplied `initialCloudRepository` prefill.
    if (
      isLoadingRepos ||
      repositories.length === 0 ||
      !selectedRepository ||
      selectedCloudRepository
    ) {
      return;
    }

    setSelectedRepository(null);
    if (lastUsedCloudRepository === selectedRepository) {
      setLastUsedCloudRepository(null);
    }
  }, [
    isLoadingRepos,
    repositories.length,
    lastUsedCloudRepository,
    selectedCloudRepository,
    selectedRepository,
    setLastUsedCloudRepository,
  ]);

  useEffect(() => {
    if (view.folderId) {
      const folder = folders.find((f) => f.id === view.folderId);
      if (folder) {
        setSelectedDirectory(folder.path);
      }
    }
  }, [view.folderId, folders]);

  useEffect(() => {
    setCloudBranchSearchQuery("");
    setIsCloudBranchPickerOpen(false);
  }, []);

  const effectiveRepoPath =
    workspaceMode === "cloud" ? selectedCloudRepository : selectedDirectory;

  const setSelectedEnvironment = useCallback(
    (envId: string | null) => {
      setSelectedEnvironmentRaw(envId);
      if (effectiveRepoPath) {
        setLastUsedEnvironment(effectiveRepoPath, envId);
      }
    },
    [effectiveRepoPath, setLastUsedEnvironment],
  );

  useEffect(() => {
    setSelectedBranch(null);

    if (effectiveRepoPath) {
      setSelectedEnvironmentRaw(getLastUsedEnvironment(effectiveRepoPath));
    } else {
      setSelectedEnvironmentRaw(null);
    }
  }, [effectiveRepoPath, getLastUsedEnvironment]);

  const effectiveWorkspaceMode = workspaceMode;

  // Get current values from preview config options for task creation.
  // Defaults ensure values are always passed even before the preview config loads.
  const currentModel =
    modelOption?.type === "select" ? modelOption.currentValue : undefined;
  const adapterDefault = adapter === "codex" ? "auto" : "plan";
  const modeFallback =
    defaultInitialTaskMode === "last_used"
      ? (lastUsedInitialTaskMode ?? adapterDefault)
      : adapterDefault;
  const currentExecutionMode =
    getCurrentModeFromConfigOptions(modeOption ? [modeOption] : undefined) ??
    modeFallback;
  const currentReasoningLevel =
    thoughtOption?.type === "select" ? thoughtOption.currentValue : undefined;

  const branchForTaskCreation =
    effectiveWorkspaceMode === "worktree" || effectiveWorkspaceMode === "cloud"
      ? selectedBranch
      : null;

  const { isCreatingTask, canSubmit, handleSubmit } = useTaskCreation({
    editorRef,
    selectedDirectory,
    selectedRepository: selectedCloudRepository,
    githubUserIntegrationId: selectedGithubUserIntegrationId,
    workspaceMode: effectiveWorkspaceMode,
    branch: branchForTaskCreation,
    editorIsEmpty,
    adapter,
    executionMode: currentExecutionMode,
    model: currentModel,
    reasoningLevel: currentReasoningLevel,
    onTaskCreated,
    environmentId: selectedEnvironment,
    sandboxEnvironmentId:
      effectiveWorkspaceMode === "cloud" && selectedCloudEnvId
        ? selectedCloudEnvId
        : undefined,
    signalReportId: activeReportAssociation?.reportId,
  });

  const handleModeChange = useCallback(
    (value: string) => {
      if (modeOption) {
        setConfigOption(modeOption.id, value);
      }
    },
    [modeOption, setConfigOption],
  );

  const handleModelChange = useCallback(
    (value: string) => {
      if (modelOption) {
        setConfigOption(modelOption.id, value);
      }
    },
    [modelOption, setConfigOption],
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

  const { isOnline } = useConnectivity();
  const promptSessionId = sessionId;

  // Populate command list for @ file mentions + / skills on mount
  useEffect(() => {
    let cancelled = false;
    trpcClient.skills.list.query().then((skills) => {
      if (cancelled) return;
      useDraftStore.getState().actions.setCommands(
        promptSessionId,
        skills.map((s) => ({ name: s.name, description: s.description })),
      );
    });
    return () => {
      cancelled = true;
      useDraftStore.getState().actions.clearCommands(promptSessionId);
    };
  }, [promptSessionId]);

  const hasHistory = useTaskInputHistoryStore((s) => s.entries.length > 0);
  const getPromptHistory = useCallback(
    () => useTaskInputHistoryStore.getState().entries.map((e) => e.text),
    [],
  );
  const handleHistorySelect = useCallback((text: string) => {
    editorRef.current?.setContent(text);
    editorRef.current?.focus();
  }, []);
  const hasPendingDraft = useCallback(
    () => !(editorRef.current?.isEmpty() ?? true),
    [],
  );
  const hints = [
    "@ to add files",
    "/ for skills",
    hasHistory ? "\u2191\u2193 for history" : "",
  ]
    .filter(Boolean)
    .join(", ");

  useAutoFocusOnTyping(editorRef, isCreatingTask);

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

  const handleContainerClick = useCallback((e: React.MouseEvent) => {
    if (!e.currentTarget.contains(e.target as Node)) return;
    if ((e.target as HTMLElement).closest(FOCUSABLE_SELECTOR)) return;
    editorRef.current?.focus();
  }, []);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: drag-and-drop container
    // biome-ignore lint/a11y/useKeyWithClickEvents: click delegates focus to the editor; keyboard users tab into it directly
    <div
      ref={containerRef}
      onClick={handleContainerClick}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className="relative h-full w-full"
    >
      <DropZoneOverlay isVisible={isDraggingFile} />
      <Flex
        align="center"
        justify="center"
        height="100%"
        className="relative px-4"
      >
        <DotPatternBackground className="h-[100.333%]" />
        <Flex
          direction="column"
          gap="2"
          style={{
            zIndex: 1,
          }}
          className="relative w-full max-w-[600px]"
        >
          <Flex gap="2" align="center" className="min-w-0">
            <WorkspaceModeSelect
              value={workspaceMode}
              onChange={setWorkspaceMode}
              selectedCloudEnvironmentId={selectedCloudEnvId}
              onCloudEnvironmentChange={setSelectedCloudEnvId}
              cloudAvailable={cloudAvailable}
              size="1"
            />
            {workspaceMode === "worktree" && (
              <EnvironmentSelector
                repoPath={effectiveRepoPath ?? null}
                value={selectedEnvironment}
                onChange={setSelectedEnvironment}
                disabled={isCreatingTask}
              />
            )}
            <ButtonGroup
              ref={buttonGroupRef}
              data-tour="folder-picker"
              data-tour-ready={
                (
                  workspaceMode === "cloud"
                    ? selectedRepository
                    : selectedDirectory
                )
                  ? "true"
                  : undefined
              }
            >
              {workspaceMode === "cloud" ? (
                <GitHubRepoPicker
                  value={selectedRepository}
                  onChange={handleRepositorySelect}
                  repositories={
                    isCloudRepoPickerOpen
                      ? visibleCloudRepositories
                      : repositories
                  }
                  isLoading={
                    isLoadingRepos ||
                    (isCloudRepoPickerOpen && cloudRepositoriesLoading)
                  }
                  isRefreshing={isRefreshingRepos}
                  onRefresh={handleRefreshRepositories}
                  open={isCloudRepoPickerOpen}
                  onOpenChange={handleCloudRepoPickerOpenChange}
                  searchQuery={cloudRepoSearchQuery}
                  onSearchQueryChange={handleCloudRepoSearchChange}
                  hasMore={cloudRepositoriesHasMore}
                  onLoadMore={handleLoadMoreCloudRepositories}
                  placeholder="Select repository..."
                  size="1"
                  disabled={isCreatingTask}
                />
              ) : (
                <FolderPicker
                  value={selectedDirectory}
                  onChange={setSelectedDirectory}
                  placeholder="Select repository..."
                  size="1"
                  anchor={buttonGroupRef}
                />
              )}
              <BranchSelector
                repoPath={
                  workspaceMode === "cloud"
                    ? selectedCloudRepository
                    : selectedDirectory
                }
                currentBranch={currentBranch}
                defaultBranch={
                  workspaceMode === "cloud" ? cloudDefaultBranch : defaultBranch
                }
                disabled={
                  isCreatingTask ||
                  (workspaceMode === "cloud" && !selectedCloudRepository)
                }
                loading={workspaceMode === "cloud" ? false : branchLoading}
                workspaceMode={workspaceMode}
                selectedBranch={selectedBranch}
                onBranchSelect={setSelectedBranch}
                cloudBranches={cloudBranches}
                cloudBranchesLoading={cloudBranchesLoading}
                isRefreshing={cloudBranchesRefreshing}
                cloudBranchesFetchingMore={cloudBranchesFetchingMore}
                cloudBranchesHasMore={cloudBranchesHasMore}
                cloudSearchQuery={cloudBranchSearchQuery}
                onCloudPickerOpen={handleCloudBranchPickerOpen}
                onCloudPickerClose={handleCloudBranchPickerClose}
                onCloudSearchChange={handleCloudBranchSearchChange}
                onCloudLoadMore={handleLoadMoreCloudBranches}
                onRefresh={
                  workspaceMode === "cloud" ? handleRefreshBranches : undefined
                }
                anchor={buttonGroupRef}
              />
            </ButtonGroup>
            {cloudRegion === "dev" && (
              <Flex align="center" gap="1" className="shrink-0">
                <span
                  className="inline-block h-2 w-2 rounded-full bg-orange-9"
                  aria-hidden
                />
                <Text color="orange" className="font-medium text-[13px]">
                  Dev
                </Text>
              </Flex>
            )}
          </Flex>

          <Flex direction="column" gap="0">
            <PromptInput
              ref={editorRef}
              sessionId={promptSessionId}
              placeholder={`What do you want to ship? ${hints}`}
              editorHeight="large"
              disabled={isCreatingTask}
              isLoading={isCreatingTask}
              autoFocus
              clearOnSubmit={false}
              submitDisabledExternal={!canSubmit || isCreatingTask || !isOnline}
              tourTarget="task-input"
              repoPath={selectedDirectory}
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
                  isConnecting={isPreviewLoading}
                  onModelChange={handleModelChange}
                />
              }
              historyButton={
                <PromptHistoryDialog
                  onSelect={handleHistorySelect}
                  hasPendingDraft={hasPendingDraft}
                  disabled={isCreatingTask}
                />
              }
              reasoningSelector={
                !isPreviewLoading && (
                  <ReasoningLevelSelector
                    thoughtOption={thoughtOption}
                    adapter={adapter}
                    onChange={handleThoughtChange}
                    disabled={isCreatingTask}
                  />
                )
              }
              getPromptHistory={getPromptHistory}
              onEmptyChange={handleEditorEmptyChange}
              onSubmitClick={handleSubmit}
              onSubmit={() => {
                if (canSubmit) handleSubmit();
              }}
            />
            {activeReportAssociation && (
              <div className="-mt-px mx-2 flex select-none items-center justify-between gap-2 rounded-b-md border border-blue-6 border-t-0 bg-blue-2 px-2 py-1 text-[12px] text-blue-11">
                <span className="flex min-w-0 flex-1 items-center gap-1">
                  <span className="shrink-0">
                    This task will be associated with report
                  </span>
                  <button
                    type="button"
                    onClick={handleOpenAssociatedReport}
                    className="min-w-0 truncate text-left font-medium underline underline-offset-2 hover:text-blue-12"
                  >
                    {activeReportAssociation.title || "Untitled report"}
                  </button>
                </span>
                <Tooltip content="Exit Inbox mode">
                  <button
                    type="button"
                    onClick={handleDismissReportAssociation}
                    aria-label="Exit Inbox mode"
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-blue-10 hover:bg-blue-4 hover:text-blue-12"
                  >
                    <X size={12} />
                  </button>
                </Tooltip>
              </div>
            )}
            {effectiveWorkspaceMode === "cloud" &&
              !isLoadingRepos &&
              !hasGithubIntegration && (
                <div className="mx-2 mt-2">
                  <CloudGithubMissingNotice />
                </div>
              )}
          </Flex>
        </Flex>
      </Flex>

      <GitBranchDialog
        open={branchOpen}
        onOpenChange={(open) => {
          if (!open) gitActions.closeBranch();
        }}
        branchName={newBranchName}
        onBranchNameChange={handleNewBranchNameChange}
        onConfirm={handleCreateBranch}
        isSubmitting={isCreatingBranch}
        error={branchError}
      />
    </div>
  );
}
