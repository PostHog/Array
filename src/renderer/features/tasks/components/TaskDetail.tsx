import { AsciiArt } from "@components/AsciiArt";
import { ResizeHandle } from "@components/ui/ResizeHandle";
import { PlanEditor } from "@features/editor/components/PlanEditor";
import { PlanView } from "@features/editor/components/PlanView";
import { RichTextEditor } from "@features/editor/components/RichTextEditor";
import { TaskArtifacts } from "@features/tasks/components/TaskArtifacts";
import { useCliPanelResize } from "@features/tasks/hooks/useCliPanelResize";
import { useTasks, useUpdateTask } from "@features/tasks/hooks/useTasks";
import { useTaskExecutionStore } from "@features/tasks/stores/taskExecutionStore";
import { useBlurOnEscape } from "@hooks/useBlurOnEscape";
import { useRepositoryIntegration } from "@hooks/useIntegrations";
import { useStatusBar } from "@hooks/useStatusBar";
import { WarningCircleIcon } from "@phosphor-icons/react";
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
import type { ClarifyingQuestion, Task } from "@shared/types";
import { useLayoutStore } from "@stores/layoutStore";
import { useTabStore } from "@stores/tabStore";
import {
  REPO_NOT_IN_INTEGRATION_WARNING,
  repoConfigToKey,
} from "@utils/repository";
import { format, formatDistanceToNow } from "date-fns";
import { useEffect } from "react";
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
    getRepoWorkingDir,
    setRepoPath,
    setPlanModePhase,
    setClarifyingQuestions,
    addQuestionAnswer,
    setPlanContent,
    setSelectedArtifact,
  } = useTaskExecutionStore();
  const { isRepoInIntegration } = useRepositoryIntegration();
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
    watch,
  } = useForm({
    defaultValues: {
      title: task.title,
      description: task.description || "",
      repository: repoConfigToKey(task.repository_config),
    },
  });

  const repositoryValue = watch("repository");

  // Initialize repoPath from mapping if task has repository_config
  useEffect(() => {
    if (task.repository_config && !repoPath) {
      const repoKey = repoConfigToKey(task.repository_config);
      if (repoKey) {
        const savedPath = getRepoWorkingDir(repoKey);
        if (savedPath) {
          setRepoPath(task.id, savedPath);
        }
      }
    }
  }, [
    task.id,
    task.repository_config,
    repoPath,
    getRepoWorkingDir,
    setRepoPath,
  ]);

  useEffect(() => {
    resetForm({
      title: task.title,
      description: task.description || "",
      repository: repoConfigToKey(task.repository_config),
    });
  }, [task.title, task.description, task.repository_config, resetForm]);

  useStatusBar(
    {
      statusText: isRunning ? "Agent running..." : "Task details",
      keyHints: [
        {
          keys: [navigator.platform.includes("Mac") ? "⌘" : "Ctrl", "K"],
          description: "Command",
        },
        {
          keys: [navigator.platform.includes("Mac") ? "⌘" : "Ctrl", "R"],
          description: "Refresh",
        },
      ],
      mode: "replace",
    },
    [isRunning],
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

  // Listen for research_questions artifact event from agent
  useEffect(() => {
    // Check logs for research_questions artifact event
    const artifactEvent = logs.find(
      (log) => log.type === "artifact" && "kind" in log && "content" in log,
    );

    if (artifactEvent && (clarifyingQuestions?.length ?? 0) === 0) {
      // Type guard to check if the content is an array of questions
      const event = artifactEvent as {
        type: string;
        ts: number;
        kind?: string;
        content?: Array<{
          id: string;
          question: string;
          options: string[];
        }>;
      };

      if (event.kind === "research_questions" && event.content) {
        const questions = event.content;

        console.log(
          "[TaskDetail] Received research_questions artifact with",
          questions.length,
          "questions",
        );

        // Convert to ClarifyingQuestion format
        const clarifyingQs: ClarifyingQuestion[] = questions.map(
          (q: { id: string; question: string; options: string[] }) => ({
            id: q.id,
            question: q.question,
            options: q.options,
            requiresInput: q.options.some((opt: string) =>
              opt.toLowerCase().includes("something else"),
            ),
          }),
        );

        setClarifyingQuestions(task.id, clarifyingQs);
        setPlanModePhase(task.id, "questions");
      }
    }
  }, [
    logs,
    clarifyingQuestions?.length,
    task.id,
    setClarifyingQuestions,
    setPlanModePhase,
  ]);

  // Listen for plan completion
  useEffect(() => {
    if (planModePhase === "planning" && !isRunning) {
      // Plan generation completed, load plan content and switch to review
      const loadPlan = async () => {
        if (repoPath) {
          try {
            const content = await window.electronAPI?.readPlanFile(
              repoPath,
              task.id,
            );
            if (content) {
              setPlanContent(task.id, content);
              setPlanModePhase(task.id, "review");
            }
          } catch (error) {
            console.error("Failed to load plan:", error);
          }
        }
      };
      loadPlan();
    }
  }, [
    planModePhase,
    isRunning,
    repoPath,
    task.id,
    setPlanContent,
    setPlanModePhase,
  ]);

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
                  <DataList.Label>Repository</DataList.Label>
                  <DataList.Value>
                    <Flex align="center" gap="2">
                      {repositoryValue ? (
                        <Code size="2" color="gray">
                          {repositoryValue}
                        </Code>
                      ) : (
                        <Text size="2" color="gray">
                          No repository connected
                        </Text>
                      )}
                      {repositoryValue &&
                        !isRepoInIntegration(repositoryValue) && (
                          <Tooltip content={REPO_NOT_IN_INTEGRATION_WARNING}>
                            <WarningCircleIcon
                              size={16}
                              weight="fill"
                              style={{ color: "var(--orange-9)" }}
                            />
                          </Tooltip>
                        )}
                    </Flex>
                  </DataList.Value>
                </DataList.Item>

                <DataList.Item>
                  <DataList.Label>Working Directory</DataList.Label>
                  <DataList.Value>
                    {repoPath ? (
                      <Code size="2" color="gray">
                        {repoPath.replace(/^\/Users\/[^/]+/, "~")}
                      </Code>
                    ) : (
                      <Text size="2" color="gray">
                        Not set
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
