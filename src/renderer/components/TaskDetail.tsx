import { DiamondIcon, WarningCircleIcon } from "@phosphor-icons/react";
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
import { format, formatDistanceToNow } from "date-fns";
import { useEffect, useMemo } from "react";
import { Controller, useForm } from "react-hook-form";
import { useBlurOnEscape } from "../hooks/useBlurOnEscape";
import { useRepositoryIntegration } from "../hooks/useRepositoryIntegration";
import { useTasks, useUpdateTask } from "../hooks/useTasks";
import { useWorkflowStages, useWorkflows } from "../hooks/useWorkflows";
import { useStatusBarStore } from "../stores/statusBarStore";
import { useTabStore } from "../stores/tabStore";
import { useTaskExecutionStore } from "../stores/taskExecutionStore";
import {
  REPO_NOT_IN_INTEGRATION_WARNING,
  repoConfigToKey,
} from "../utils/repository";
import { AsciiArt } from "./AsciiArt";
import { Combobox } from "./Combobox";
import { LogView } from "./LogView";
import { RichTextEditor } from "./RichTextEditor";

interface TaskDetailProps {
  task: Task;
}

export function TaskDetail({ task: initialTask }: TaskDetailProps) {
  const { setStatusBar, reset } = useStatusBarStore();
  const {
    getTaskState,
    setRunMode: setStoreRunMode,
    runTask,
    cancelTask,
    clearTaskLogs,
    getRepoWorkingDir,
    setRepoPath,
  } = useTaskExecutionStore();
  const { isRepoInIntegration } = useRepositoryIntegration();
  const { data: tasks = [] } = useTasks();
  const { mutate: updateTask } = useUpdateTask();
  const { updateTabTitle, activeTabId } = useTabStore();
  const { data: workflows = [] } = useWorkflows();

  const task = tasks.find((t) => t.id === initialTask.id) || initialTask;

  const { data: workflowStages = [] } = useWorkflowStages(task.workflow || "");

  const workflowOptions = useMemo(
    () =>
      workflows.map((workflow) => ({
        value: workflow.id,
        label: workflow.name,
      })),
    [workflows],
  );

  const currentStageName = useMemo(() => {
    if (!task.current_stage) return "Backlog";
    const stage = workflowStages.find((s) => s.id === task.current_stage);
    return stage?.name || task.current_stage;
  }, [task.current_stage, workflowStages]);

  const taskState = getTaskState(task.id);

  const { isRunning, logs, repoPath, runMode, progress } = taskState;

  const {
    handleSubmit,
    reset: resetForm,
    control,
    watch,
  } = useForm({
    defaultValues: {
      title: task.title,
      description: task.description || "",
      workflow: task.workflow || "",
      repository: repoConfigToKey(task.repository_config),
    },
  });

  const repositoryValue = watch("repository");

  const showRepoWarning = useMemo(
    () => repositoryValue && !isRepoInIntegration(repositoryValue),
    [repositoryValue, isRepoInIntegration],
  );

  const displayRepoPath = useMemo(() => {
    if (!repoPath) return null;
    // Replace home directory with ~
    const homeDirPattern = /^\/Users\/[^/]+/; // macOS/Linux pattern
    if (homeDirPattern.test(repoPath)) {
      return repoPath.replace(homeDirPattern, "~");
    }
    return repoPath;
  }, [repoPath]);

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
      workflow: task.workflow || "",
      repository: repoConfigToKey(task.repository_config),
    });
  }, [
    task.title,
    task.description,
    task.workflow,
    task.repository_config,
    resetForm,
  ]);

  // Default to first workflow if not set
  useEffect(() => {
    if (workflows.length > 0 && !task.workflow) {
      const defaultWorkflow =
        workflows.find((w) => w.is_active && w.is_default) || workflows[0];
      if (defaultWorkflow) {
        updateTask({
          taskId: task.id,
          updates: { workflow: defaultWorkflow.id },
        });
      }
    }
  }, [workflows, task.workflow, task.id, updateTask]);

  useEffect(() => {
    setStatusBar({
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
    });

    return () => {
      reset();
    };
  }, [setStatusBar, reset, isRunning]);

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
      <Flex height="100%" style={{ flex: 1 }}>
        <Box width="50%" className="border-gray-6 border-r" overflowY="auto">
          <Box p="4">
            <Flex direction="column" gap="4">
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
                      width: "100%",
                    }}
                  />
                )}
              />

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
                <DataList.Item>
                  <DataList.Label>Status</DataList.Label>
                  <DataList.Value>
                    <Button size="1" color="gray">
                      {currentStageName}
                    </Button>
                  </DataList.Value>
                </DataList.Item>

                {progress?.has_progress && (
                  <DataList.Item>
                    <DataList.Label>Progress</DataList.Label>
                    <DataList.Value>
                      <Text size="2">
                        {(progress.completed_steps ?? 0) + 1}/
                        {typeof progress.total_steps === "number"
                          ? progress.total_steps
                          : "-"}
                        {typeof progress.total_steps === "number" &&
                          ` · ${Math.round((((progress.completed_steps ?? 0) + 1) / progress.total_steps) * 100)}%`}
                        {progress.current_step && ` · ${progress.current_step}`}
                      </Text>
                    </DataList.Value>
                  </DataList.Item>
                )}

                {workflowOptions.length > 0 && (
                  <DataList.Item>
                    <DataList.Label>Workflow</DataList.Label>
                    <DataList.Value>
                      <Controller
                        name="workflow"
                        control={control}
                        rules={{ required: true }}
                        render={({ field }) => (
                          <Combobox
                            items={workflowOptions}
                            value={field.value}
                            onValueChange={(value) => {
                              field.onChange(value);
                              updateTask({
                                taskId: task.id,
                                updates: { workflow: value },
                              });
                            }}
                            placeholder="Select a workflow..."
                            searchPlaceholder="Search workflows..."
                            emptyMessage="No workflows found"
                            size="1"
                            variant="outline"
                            icon={<DiamondIcon />}
                          />
                        )}
                      />
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
                      {showRepoWarning && (
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
                        {displayRepoPath}
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
                      ? "Run Agent"
                      : "Run Agent (Local)"}
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

        {/* Right pane - Logs */}
        <Box
          width="50%"
          className="bg-panel-solid"
          style={{ position: "relative" }}
        >
          {/* Background ASCII Art */}
          <Box style={{ position: "absolute", inset: 0, zIndex: 0 }}>
            <AsciiArt scale={1} opacity={0.1} />
          </Box>
          {/* Foreground LogView */}
          <Box style={{ position: "relative", zIndex: 1, height: "100%" }}>
            <LogView
              logs={logs}
              isRunning={isRunning}
              onClearLogs={handleClearLogs}
            />
          </Box>
        </Box>
      </Flex>
    </Flex>
  );
}
