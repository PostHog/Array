import { Pencil1Icon } from "@radix-ui/react-icons";
import {
  Badge,
  Box,
  Button,
  Code,
  DataList,
  Flex,
  Link,
  SegmentedControl,
} from "@radix-ui/themes";
import type { Task } from "@shared/types";
import { format } from "date-fns";
import { useEffect } from "react";
import { useStatusBarStore } from "../stores/statusBarStore";
import { useTaskExecutionStore } from "../stores/taskExecutionStore";
import { AsciiArt } from "./AsciiArt";
import { LogView } from "./LogView";

interface TaskDetailProps {
  task: Task;
}

export function TaskDetail({ task }: TaskDetailProps) {
  const { setStatusBar, reset } = useStatusBarStore();
  const {
    getTaskState,
    setRunMode: setStoreRunMode,
    selectRepositoryForTask,
    runTask,
    cancelTask,
    clearTaskLogs,
  } = useTaskExecutionStore();

  // Get persistent state for this task
  const taskState = getTaskState(task.id);
  const { isRunning, logs, repoPath, runMode } = taskState;

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

  return (
    <Flex height="100%">
      {/* Left pane - Task details */}
      <Box width="50%" className="border-gray-6 border-r" overflowY="auto">
        <Box p="4">
          <Box mb="4">
            <Code size="5">{task.title}</Code>
          </Box>

          <DataList.Root>
            <DataList.Item>
              <DataList.Label>Status</DataList.Label>
              <DataList.Value>
                <Badge color="gray">{task.current_stage || "Backlog"}</Badge>
              </DataList.Value>
            </DataList.Item>

            {task.repository_config &&
            typeof task.repository_config === "object" &&
            "organization" in task.repository_config &&
            "repository" in task.repository_config ? (
              <DataList.Item>
                <DataList.Label>Remote Repository</DataList.Label>
                <DataList.Value>
                  <Link
                    href={`https://github.com/${String(task.repository_config.organization)}/${String(task.repository_config.repository)}`}
                    target="_blank"
                    size="2"
                  >
                    {String(task.repository_config.organization)}/
                    {String(task.repository_config.repository)} →
                  </Link>
                </DataList.Value>
              </DataList.Item>
            ) : null}

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
                {task.description || "No description provided"}
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
