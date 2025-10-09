import { ExternalLinkIcon, Pencil1Icon } from "@radix-ui/react-icons";
import {
  Badge,
  Box,
  Button,
  Code,
  DataList,
  Flex,
  Link,
  SegmentedControl,
  Text,
} from "@radix-ui/themes";
import type { Task } from "@shared/types";
import { format } from "date-fns";
import { useEffect, useMemo, useRef, useState } from "react";
import { useIntegrationStore } from "../stores/integrationStore";
import { useStatusBarStore } from "../stores/statusBarStore";
import { useTabStore } from "../stores/tabStore";
import { useTaskExecutionStore } from "../stores/taskExecutionStore";
import { useTaskStore } from "../stores/taskStore";
import { useWorkflowStore } from "../stores/workflowStore";
import { AsciiArt } from "./AsciiArt";
import { Combobox } from "./Combobox";
import { LogView } from "./LogView";

interface TaskDetailProps {
  task: Task;
}

export function TaskDetail({ task: initialTask }: TaskDetailProps) {
  const { setStatusBar, reset } = useStatusBarStore();
  const {
    getTaskState,
    setRunMode: setStoreRunMode,
    selectRepositoryForTask,
    runTask,
    cancelTask,
    clearTaskLogs,
  } = useTaskExecutionStore();
  const { repositories } = useIntegrationStore();
  const { updateTask, tasks } = useTaskStore();
  const { updateTabTitle, activeTabId } = useTabStore();
  const workflows = useWorkflowStore((state) => state.workflows);
  const fetchWorkflows = useWorkflowStore((state) => state.fetchWorkflows);
  const workflowOptions = useMemo(
    () =>
      workflows.map((workflow) => ({
        value: workflow.id,
        label: workflow.name,
      })),
    [workflows],
  );

  // Get the latest task data from the store
  const task = tasks.find((t) => t.id === initialTask.id) || initialTask;

  // Get persistent state for this task
  const taskState = getTaskState(task.id);
  const { isRunning, logs, repoPath, runMode, progress } = taskState;

  const [selectedRepo, setSelectedRepo] = useState<string>(() => {
    if (task.repository_config) {
      return `${task.repository_config.organization}/${task.repository_config.repository}`;
    }
    return "";
  });

  const titleRef = useRef<HTMLElement>(null);
  const originalTitleRef = useRef(task.title);
  const descriptionRef = useRef<HTMLDivElement>(null);
  const originalDescriptionRef = useRef(task.description || "");

  useEffect(() => {
    if (titleRef.current && titleRef.current.textContent !== task.title) {
      titleRef.current.textContent = task.title;
      originalTitleRef.current = task.title;
    }
  }, [task.title]);

  useEffect(() => {
    const desc = task.description || "";
    if (descriptionRef.current && descriptionRef.current.textContent !== desc) {
      descriptionRef.current.textContent = desc;
      originalDescriptionRef.current = desc;
    }
  }, [task.description]);

  useEffect(() => {
    if (!workflows.length) {
      void fetchWorkflows({ skipLoadingState: true });
    }
  }, [workflows.length, fetchWorkflows]);

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

  // Simple event handlers that delegate to store actions
  const handleSelectRepo = () => {
    selectRepositoryForTask(task.id);
  };

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

  const handleWorkflowChange = async (value: string) => {
    const nextWorkflow =
      !value || value === "__none__" ? null : (value as string);
    await updateTask(task.id, { workflow: nextWorkflow });
  };

  const handleRepositoryChange = async (value: string) => {
    setSelectedRepo(value);

    let repositoryConfig:
      | { organization: string; repository: string }
      | undefined;

    if (value && value !== "__none__") {
      const [organization, repository] = value.split("/");
      if (organization && repository) {
        repositoryConfig = { organization, repository };
      }
    }

    await updateTask(task.id, { repository_config: repositoryConfig });
  };

  const handleTitleBlur = async () => {
    const newTitle = titleRef.current?.textContent?.trim() || "";
    if (newTitle && newTitle !== originalTitleRef.current) {
      await updateTask(task.id, { title: newTitle });
      originalTitleRef.current = newTitle;
      if (activeTabId) {
        updateTabTitle(activeTabId, newTitle);
      }
    } else if (!newTitle) {
      if (titleRef.current) {
        titleRef.current.textContent = originalTitleRef.current;
      }
    }
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      titleRef.current?.blur();
    } else if (e.key === "Escape") {
      if (titleRef.current) {
        titleRef.current.textContent = originalTitleRef.current;
      }
      titleRef.current?.blur();
    }
  };

  const handleDescriptionBlur = async () => {
    const newDescription = descriptionRef.current?.textContent?.trim() || "";
    if (newDescription !== originalDescriptionRef.current) {
      await updateTask(task.id, {
        description: newDescription || undefined,
      });
      originalDescriptionRef.current = newDescription;
    }
  };

  const handleDescriptionKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      descriptionRef.current?.blur();
    } else if (e.key === "Escape") {
      if (descriptionRef.current) {
        descriptionRef.current.textContent = originalDescriptionRef.current;
      }
      descriptionRef.current?.blur();
    }
  };

  return (
    <Flex height="100%">
      {/* Left pane - Task details */}
      <Box width="50%" className="border-gray-6 border-r" overflowY="auto">
        <Box p="4">
          <Box mb="4">
            <Code
              ref={titleRef}
              size="5"
              contentEditable
              suppressContentEditableWarning
              spellCheck={false}
              onBlur={handleTitleBlur}
              onKeyDown={handleTitleKeyDown}
              style={{ cursor: "text", outline: "none" }}
            >
              {task.title}
            </Code>
          </Box>

          <DataList.Root>
            <DataList.Item>
              <DataList.Label>Status</DataList.Label>
              <DataList.Value>
                <Badge color="gray">{task.current_stage || "Backlog"}</Badge>
              </DataList.Value>
            </DataList.Item>

            <DataList.Item>
              <DataList.Label>Progress</DataList.Label>
              <DataList.Value>
                {progress?.has_progress ? (
                  <Flex direction="column" gap="1">
                    <Badge
                      color={
                        progress.status === "completed"
                          ? "green"
                          : progress.status === "failed"
                            ? "red"
                            : "blue"
                      }
                    >
                      {progress.status?.replace(/_/g, " ") ?? "in progress"}
                    </Badge>
                    <Text size="2" color="gray">
                      Steps {progress.completed_steps ?? 0}/
                      {typeof progress.total_steps === "number"
                        ? progress.total_steps
                        : "?"}
                      {typeof progress.progress_percentage === "number"
                        ? ` · ${Math.round(progress.progress_percentage)}%`
                        : ""}
                    </Text>
                    {progress.current_step && (
                      <Text size="2" color="gray">
                        Current step: {progress.current_step}
                      </Text>
                    )}
                  </Flex>
                ) : (
                  <Code size="2" color="gray">
                    No progress yet
                  </Code>
                )}
              </DataList.Value>
            </DataList.Item>

            <DataList.Item>
              <DataList.Label>Workflow</DataList.Label>
              <DataList.Value>
                {workflowOptions.length > 0 ? (
                  <Combobox
                    items={workflowOptions}
                    value={task.workflow ?? "__none__"}
                    onValueChange={handleWorkflowChange}
                    placeholder="Select a workflow..."
                    searchPlaceholder="Search workflows..."
                    emptyMessage="No workflows found"
                    noneLabel="No workflow"
                    size="2"
                  />
                ) : (
                  <Code size="2" color="gray">
                    No workflows available
                  </Code>
                )}
              </DataList.Value>
            </DataList.Item>

            <DataList.Item>
              <DataList.Label>Repository</DataList.Label>
              <DataList.Value>
                <Flex gap="2" align="center">
                  {repositories.length > 0 ? (
                    <Combobox
                      items={repositories.map((repo) => ({
                        value: `${repo.organization}/${repo.repository}`,
                        label: `${repo.organization}/${repo.repository}`,
                      }))}
                      value={selectedRepo}
                      onValueChange={handleRepositoryChange}
                      placeholder="Select a repository..."
                      searchPlaceholder="Search repositories..."
                      emptyMessage="No repositories found"
                      size="2"
                    />
                  ) : selectedRepo ? (
                    <Code size="2">{selectedRepo}</Code>
                  ) : (
                    <Code size="2" color="gray">
                      None
                    </Code>
                  )}
                  {selectedRepo && selectedRepo !== "__none__" && (
                    <Button
                      size="1"
                      variant="ghost"
                      onClick={() =>
                        window.electronAPI.openExternal(
                          `https://github.com/${selectedRepo}`,
                        )
                      }
                    >
                      <ExternalLinkIcon />
                    </Button>
                  )}
                </Flex>
              </DataList.Value>
            </DataList.Item>

            {task.github_branch && (
              <DataList.Item>
                <DataList.Label>Branch</DataList.Label>
                <DataList.Value>{task.github_branch}</DataList.Value>
              </DataList.Item>
            )}

            {task.github_pr_url && (
              <DataList.Item>
                <DataList.Label>Pull Request</DataList.Label>
                <DataList.Value>
                  <Link href={task.github_pr_url} target="_blank" size="2">
                    View Pull Request →
                  </Link>
                </DataList.Value>
              </DataList.Item>
            )}

            <DataList.Item>
              <DataList.Label>Created</DataList.Label>
              <DataList.Value>
                {format(new Date(task.created_at), "PPP p")}
              </DataList.Value>
            </DataList.Item>

            <DataList.Item>
              <DataList.Label>Description</DataList.Label>
              <DataList.Value>
                <Box
                  ref={descriptionRef}
                  contentEditable
                  suppressContentEditableWarning
                  spellCheck={false}
                  onBlur={handleDescriptionBlur}
                  onKeyDown={handleDescriptionKeyDown}
                  style={{
                    cursor: "text",
                    outline: "none",
                    minHeight: "1.5em",
                  }}
                >
                  {task.description || "No description provided"}
                </Box>
              </DataList.Value>
            </DataList.Item>

            <DataList.Item>
              <DataList.Label>Working Directory</DataList.Label>
              <DataList.Value>
                {repoPath ? (
                  <Button
                    size="1"
                    variant="ghost"
                    onClick={handleSelectRepo}
                    className="group cursor-pointer"
                  >
                    <Code variant="ghost" size="2">
                      {repoPath}
                    </Code>
                    <Pencil1Icon className="ml-2 opacity-0 transition-opacity group-hover:opacity-100" />
                  </Button>
                ) : (
                  <Button size="1" variant="outline" onClick={handleSelectRepo}>
                    Choose folder
                  </Button>
                )}
              </DataList.Value>
            </DataList.Item>

            <DataList.Item>
              <DataList.Label>Mode</DataList.Label>
              <DataList.Value>
                <SegmentedControl.Root
                  value={runMode}
                  onValueChange={handleRunModeChange}
                >
                  <SegmentedControl.Item value="local">
                    Local
                  </SegmentedControl.Item>
                  <SegmentedControl.Item value="cloud">
                    Cloud
                  </SegmentedControl.Item>
                </SegmentedControl.Root>
              </DataList.Value>
            </DataList.Item>
          </DataList.Root>

          <Box mt="6">
            <Flex direction="column" gap="3">
              {!repoPath ? (
                <Button variant="classic" onClick={handleSelectRepo} size="3">
                  Choose working folder
                </Button>
              ) : (
                <Button
                  variant="classic"
                  onClick={handleRunTask}
                  disabled={isRunning}
                  size="3"
                >
                  {isRunning ? "Running..." : "Run Agent"}
                </Button>
              )}

              {isRunning && (
                <Button
                  onClick={handleCancel}
                  color="red"
                  size="3"
                  variant="outline"
                >
                  Cancel
                </Button>
              )}
            </Flex>
          </Box>
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
  );
}
