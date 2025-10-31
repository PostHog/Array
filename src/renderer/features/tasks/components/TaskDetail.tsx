import { AsciiArt } from "@components/AsciiArt";
import { ResizeHandle } from "@components/ui/ResizeHandle";
import { useAuthStore } from "@features/auth/stores/authStore";
import { PlanEditor } from "@features/editor/components/PlanEditor";
import { PlanView } from "@features/editor/components/PlanView";
import { RichTextEditor } from "@features/editor/components/RichTextEditor";
import { TaskArtifacts } from "@features/tasks/components/TaskArtifacts";
import { useCliPanelResize } from "@features/tasks/hooks/useCliPanelResize";
import { useTasks, useUpdateTask } from "@features/tasks/hooks/useTasks";
import { useTaskExecutionStore } from "@features/tasks/stores/taskExecutionStore";
import { useBlurOnEscape } from "@hooks/useBlurOnEscape";
import { useStatusBar } from "@hooks/useStatusBar";
import { GearIcon, GlobeIcon } from "@radix-ui/react-icons";
import {
  Box,
  Button,
  Code,
  DataList,
  Flex,
  Heading,
  IconButton,
  Link,
  Text,
  Tooltip,
} from "@radix-ui/themes";
import type { Task } from "@shared/types";
import { useLayoutStore } from "@stores/layoutStore";
import { useTabStore } from "@stores/tabStore";
import { expandTildePath } from "@utils/path";
import { format, formatDistanceToNow } from "date-fns";
import { useEffect, useMemo } from "react";
import { Controller, useForm } from "react-hook-form";

interface TaskDetailProps {
  task: Task;
}

export function TaskDetail({ task: initialTask }: TaskDetailProps) {
  const {
    getTaskState,
    setRunMode: setStoreRunMode,
    runTask,
    cancelTask,
    clearTaskLogs,
    setPlanModePhase,
    addQuestionAnswer,
    setPlanContent,
    setSelectedArtifact,
  } = useTaskExecutionStore();
  const { defaultWorkspace } = useAuthStore();
  const { data: tasks = [] } = useTasks();
  const { mutate: updateTask } = useUpdateTask();
  const { updateTabTitle, activeTabId } = useTabStore();
  const taskDetailSplitWidth = useLayoutStore(
    (state) => state.taskDetailSplitWidth,
  );
  const setTaskDetailSplitWidth = useLayoutStore(
    (state) => state.setTaskDetailSplitWidth,
  );
  const { isResizing, handleMouseDown } = useCliPanelResize(
    setTaskDetailSplitWidth,
  );

  const task = tasks.find((t) => t.id === initialTask.id) || initialTask;

  const taskState = getTaskState(task.id);

  const {
    isRunning,
    logs,
    repoPath,
    runMode,
    progress,
    planModePhase,
    clarifyingQuestions,
    questionAnswers,
    planContent,
    selectedArtifact,
  } = taskState;

  const {
    handleSubmit,
    reset: resetForm,
    control,
  } = useForm({
    defaultValues: {
      title: task.title,
      description: task.description || "",
    },
  });

  // Derive working path from repository and workspace (for display only)
  const derivedPath = useMemo(() => {
    if (!task.repository_config || !defaultWorkspace) return null;
    const expandedWorkspace = expandTildePath(defaultWorkspace);
    return `${expandedWorkspace}/${task.repository_config.repository}`;
  }, [task.repository_config, defaultWorkspace]);

  useEffect(() => {
    resetForm({
      title: task.title,
      description: task.description || "",
    });
  }, [task.title, task.description, resetForm]);

  useStatusBar(
    isRunning ? "Agent running..." : "Task details",
    [
      {
        keys: [navigator.platform.includes("Mac") ? "⌘" : "Ctrl", "K"],
        description: "Command",
      },
      {
        keys: [navigator.platform.includes("Mac") ? "⌘" : "Ctrl", "R"],
        description: "Refresh",
      },
    ],
    "replace",
  );

  useBlurOnEscape();

  const handleRunTask = () => {
    runTask(task.id, task);
  };

  const handleCancel = () => {
    cancelTask(task.id);
  };

  const handleRunModeChange = (value: string) => {
    setStoreRunMode(task.id, value as "local" | "cloud");
  };

  const handleClearLogs = () => {
    clearTaskLogs(task.id);
  };

  const handleAnswersComplete = async (
    answers: Array<{
      questionId: string;
      selectedOption: string;
      customInput?: string;
    }>,
  ) => {
    // Save all answers to store
    for (const answer of answers) {
      addQuestionAnswer(task.id, answer);
    }

    // Save answers to questions.json
    if (repoPath) {
      try {
        await window.electronAPI?.saveQuestionAnswers(
          repoPath,
          task.id,
          answers,
        );
        console.log("Answers saved to questions.json");

        // Set phase to planning and trigger next run
        setPlanModePhase(task.id, "planning");

        // Trigger the next phase (planning) by running the task again
        runTask(task.id, task);
      } catch (error) {
        console.error("Failed to save answers to questions.json:", error);
      }
    }
  };

  const handleClosePlan = () => {
    setPlanModePhase(task.id, "idle");
    setSelectedArtifact(task.id, null);
  };

  const handleSavePlan = (content: string) => {
    setPlanContent(task.id, content);
  };

  const handleArtifactSelect = (fileName: string) => {
    setSelectedArtifact(task.id, fileName);
    // If in plan mode, this will open the editor automatically via PlanView
  };

  const onSubmit = handleSubmit((data) => {
    if (data.title !== task.title) {
      updateTask({ taskId: task.id, updates: { title: data.title } });
      if (activeTabId) {
        updateTabTitle(activeTabId, data.title);
      }
    }
    if (data.description !== task.description) {
      updateTask({
        taskId: task.id,
        updates: { description: data.description || undefined },
      });
    }
  });

  return (
    <Flex direction="column" height="100%">
      <Flex height="100%" style={{ flex: 1, position: "relative" }}>
        <Box
          style={{ width: `calc(${100 - taskDetailSplitWidth}% - 14px)` }}
          overflowY="auto"
        >
          <Box p="4">
            <Flex direction="column" gap="4">
              <Flex direction="row" gap="2" align="baseline">
                <Code
                  size="3"
                  color="gray"
                  variant="ghost"
                  style={{ flexShrink: 0 }}
                >
                  {task.slug}
                </Code>
                <Controller
                  name="title"
                  control={control}
                  render={({ field }) => (
                    <Heading
                      size="5"
                      contentEditable
                      suppressContentEditableWarning
                      ref={(el) => {
                        if (el && el.textContent !== field.value) {
                          el.textContent = field.value;
                        }
                      }}
                      onBlur={(e) => {
                        field.onChange(e.currentTarget.textContent || "");
                        onSubmit();
                      }}
                      style={{
                        cursor: "text",
                        outline: "none",
                        flex: 1,
                        minWidth: 0,
                      }}
                    />
                  )}
                />
              </Flex>

              <Flex direction="column">
                <Controller
                  name="description"
                  control={control}
                  render={({ field }) => (
                    <RichTextEditor
                      value={field.value}
                      onChange={field.onChange}
                      repoPath={repoPath}
                      placeholder="No description provided. Use @ to mention files, or format text with markdown."
                      onBlur={onSubmit}
                      showToolbar={true}
                      minHeight="100px"
                      style={{
                        minHeight: "100px",
                      }}
                    />
                  )}
                />

                <Box className="border-gray-6 border-t" mt="4" />
              </Flex>

              <DataList.Root>
                {progress && (
                  <DataList.Item>
                    <DataList.Label>Run Status</DataList.Label>
                    <DataList.Value>
                      <Text size="2">{progress.status.replace(/_/g, " ")}</Text>
                    </DataList.Value>
                  </DataList.Item>
                )}

                <DataList.Item>
                  <DataList.Label>Author</DataList.Label>
                  <DataList.Value>
                    {task.created_by ? (
                      <Text size="2">
                        {task.created_by.first_name && task.created_by.last_name
                          ? `${task.created_by.first_name} ${task.created_by.last_name}`
                          : task.created_by.email}
                      </Text>
                    ) : (
                      <Text size="2" color="gray">
                        Unknown
                      </Text>
                    )}
                  </DataList.Value>
                </DataList.Item>

                <DataList.Item>
                  <DataList.Label>Repository</DataList.Label>
                  <DataList.Value>
                    {task.repository_config ? (
                      <Code size="2" color="gray">
                        {task.repository_config.organization}/
                        {task.repository_config.repository}
                      </Code>
                    ) : (
                      <Text size="2" color="gray">
                        No repository connected
                      </Text>
                    )}
                  </DataList.Value>
                </DataList.Item>

                <DataList.Item>
                  <DataList.Label>Working directory</DataList.Label>
                  <DataList.Value>
                    {derivedPath ? (
                      <Code size="2" color="gray">
                        {derivedPath.replace(/^\/Users\/[^/]+/, "~")}
                      </Code>
                    ) : (
                      <Text size="2" color="gray">
                        {!defaultWorkspace
                          ? "No workspace configured"
                          : "No repository selected"}
                      </Text>
                    )}
                  </DataList.Value>
                </DataList.Item>

                {task.github_branch && (
                  <DataList.Item>
                    <DataList.Label>Branch</DataList.Label>
                    <DataList.Value>
                      <Code size="2" color="gray">
                        {task.github_branch}
                      </Code>
                    </DataList.Value>
                  </DataList.Item>
                )}
              </DataList.Root>

              {task.github_pr_url && (
                <Link href={task.github_pr_url} target="_blank" size="2">
                  View Pull Request
                </Link>
              )}

              <Tooltip content={format(new Date(task.created_at), "PPP p")}>
                <Button
                  size="1"
                  variant="ghost"
                  color="gray"
                  style={{ width: "fit-content" }}
                >
                  Created{" "}
                  {formatDistanceToNow(new Date(task.created_at), {
                    addSuffix: true,
                  })}
                </Button>
              </Tooltip>
            </Flex>

            <Flex direction="column" gap="3" mt="4">
              {/* Task Artifacts */}
              {repoPath && (
                <TaskArtifacts
                  taskId={task.id}
                  repoPath={repoPath}
                  selectedArtifact={selectedArtifact}
                  onArtifactSelect={handleArtifactSelect}
                />
              )}

              <Flex gap="2">
                <Button
                  variant="classic"
                  onClick={handleRunTask}
                  disabled={isRunning}
                  size="2"
                  style={{ flex: 1 }}
                >
                  {isRunning
                    ? "Running..."
                    : runMode === "cloud"
                      ? "Run (Cloud)"
                      : "Run (Local)"}
                </Button>
                <Tooltip content="Toggle between Local or Cloud Agent">
                  <IconButton
                    size="2"
                    variant="classic"
                    color={runMode === "cloud" ? "blue" : "gray"}
                    disabled={isRunning}
                    onClick={() =>
                      handleRunModeChange(
                        runMode === "local" ? "cloud" : "local",
                      )
                    }
                  >
                    {runMode === "cloud" ? <GlobeIcon /> : <GearIcon />}
                  </IconButton>
                </Tooltip>
              </Flex>

              {isRunning && (
                <Button
                  onClick={handleCancel}
                  color="red"
                  size="2"
                  variant="outline"
                >
                  Cancel
                </Button>
              )}
            </Flex>
          </Box>
        </Box>

        <ResizeHandle isResizing={isResizing} onMouseDown={handleMouseDown} />

        {/* Right pane - Logs/Plan View */}
        <Box
          style={{
            width: `calc(${taskDetailSplitWidth}% - 14px)`,
            position: "relative",
          }}
        >
          {/* Background ASCII Art */}
          <Box style={{ position: "absolute", inset: 0, zIndex: 0 }}>
            <AsciiArt scale={1} opacity={0.1} />
          </Box>
          {/* Foreground View (PlanView or Artifact Editor) */}
          <Box style={{ position: "relative", zIndex: 1, height: "100%" }}>
            {selectedArtifact && repoPath ? (
              // Viewing an artifact - show editor
              <PlanEditor
                taskId={task.id}
                repoPath={repoPath}
                fileName={selectedArtifact}
                onClose={handleClosePlan}
                onSave={handleSavePlan}
              />
            ) : (
              <PlanView
                task={task}
                repoPath={repoPath}
                phase={planModePhase}
                questions={clarifyingQuestions}
                answers={questionAnswers}
                logs={logs}
                isRunning={isRunning}
                planContent={planContent}
                selectedArtifact={selectedArtifact}
                onAnswersComplete={handleAnswersComplete}
                onClearLogs={handleClearLogs}
                onClosePlan={handleClosePlan}
                onSavePlan={handleSavePlan}
              />
            )}
          </Box>
        </Box>
      </Flex>
    </Flex>
  );
}
