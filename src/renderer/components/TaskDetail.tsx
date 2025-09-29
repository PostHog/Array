import React, { useEffect, useRef, useState } from 'react';
import { Flex, Box, Heading, Text, Badge, Button, Link, SegmentedControl, DataList } from '@radix-ui/themes';
import { Task } from '@shared/types';
import { format } from 'date-fns';
import { useAuthStore } from '../stores/authStore';
import { useStatusBarStore } from '../stores/statusBarStore';
import { LogView } from './LogView';

interface TaskDetailProps {
  task: Task;
}

export function TaskDetail({ task }: TaskDetailProps) {
  const { client } = useAuthStore();
  const { setStatusBar, reset } = useStatusBarStore();
  const [isRunning, setIsRunning] = useState(false);
  const [logs, setLogs] = useState<any[]>([]);
  const [repoPath, setRepoPath] = useState<string | null>(null);
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
  const unsubscribeRef = useRef<null | (() => void)>(null);
  const [runMode, setRunMode] = useState<'local' | 'cloud'>('local');

  useEffect(() => {
    setStatusBar({
      statusText: isRunning ? 'Agent running...' : 'Task details',
      keyHints: [
        {
          keys: [navigator.platform.includes('Mac') ? '⌘' : 'Ctrl', 'K'],
          description: 'Command'
        },
        {
          keys: [navigator.platform.includes('Mac') ? '⌘' : 'Ctrl', 'R'],
          description: 'Refresh'
        }
      ],
      mode: 'replace'
    });

    return () => {
      reset();
    };
  }, [setStatusBar, reset, isRunning]);

  const handleSelectRepo = async () => {
    try {
      const selected = await window.electronAPI.selectDirectory();
      if (selected) {
        const isRepo = await window.electronAPI.validateRepo(selected);
        if (!isRepo) {
          setLogs(prev => [...prev, `Selected folder is not a git repository: ${selected}`]);
          return;
        }
        const canWrite = await window.electronAPI.checkWriteAccess(selected);
        if (!canWrite) {
          setLogs(prev => [...prev, `No write permission in selected folder: ${selected}`]);
          const { response } = await window.electronAPI.showMessageBox({
            type: 'warning',
            title: 'Folder is not writable',
            message: 'The selected folder is not writable by the app.',
            detail: 'Grant access by selecting a different folder or adjusting permissions.',
            buttons: ['Grant Access', 'Cancel'],
            defaultId: 0,
            cancelId: 1,
          });
          if (response === 0) {
            // Let user reselect and validate again
            return handleSelectRepo();
          }
          return;
        }
        setRepoPath(selected);
      }
    } catch (err) {
      setLogs(prev => [...prev, `Error selecting directory: ${err instanceof Error ? err.message : String(err)}`]);
    }
  };

  const handleRunTask = async () => {
    if (isRunning) return;

    // Ensure repo path is selected
    let effectiveRepoPath = repoPath;
    if (!effectiveRepoPath) {
      await handleSelectRepo();
      effectiveRepoPath = repoPath;
    }
    if (!effectiveRepoPath) {
      setLogs(prev => [...prev, 'No repository folder selected. ']);
      return;
    }
    const isRepo = await window.electronAPI.validateRepo(effectiveRepoPath);
    if (!isRepo) {
      setLogs(prev => [...prev, `Selected folder is not a git repository: ${effectiveRepoPath}`]);
      return;
    }
    const canWrite = await window.electronAPI.checkWriteAccess(effectiveRepoPath);
    if (!canWrite) {
      setLogs(prev => [...prev, `No write permission in selected folder: ${effectiveRepoPath}`]);
      const { response } = await window.electronAPI.showMessageBox({
        type: 'warning',
        title: 'Folder is not writable',
        message: 'This folder is not writable by the app.',
        detail: 'Grant access by selecting a different folder or adjusting permissions.',
        buttons: ['Grant Access', 'Cancel'],
        defaultId: 0,
        cancelId: 1,
      });
      if (response === 0) {
        await handleSelectRepo();
      }
      return;
    }

    // Build a helpful prompt for the agent
    const promptLines: string[] = [];
    promptLines.push(`Task: ${task.title}`);
    if (task.description) {
      promptLines.push('Description:');
      promptLines.push(task.description);
    }
    const prompt = promptLines.join('\n');

    setIsRunning(true);
    setLogs([
      { type: 'text', ts: Date.now(), content: `Starting ${runMode} Claude Code agent...` },
      { type: 'text', ts: Date.now(), content: `Repo: ${effectiveRepoPath}` },
    ]);

    try {
      const { taskId, channel } = await window.electronAPI.agentStart({
        prompt,
        repoPath: effectiveRepoPath,
        model: 'claude-4-sonnet',
      });
      setCurrentTaskId(taskId);

      // Subscribe to streaming events
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
      unsubscribeRef.current = window.electronAPI.onAgentEvent(channel, (ev: any) => {
        switch (ev?.type) {
          case 'token':
            if (typeof ev.content === 'string' && ev.content.trim().length > 0) {
              setLogs(prev => [...prev, { type: 'text', ts: ev.ts || Date.now(), content: ev.content }]);
            }
            break;
          case 'status':
            if (ev.phase) {
              setLogs(prev => [...prev, { type: 'status', ts: ev.ts || Date.now(), phase: ev.phase }]);
            } else if (ev.message) {
              setLogs(prev => [...prev, { type: 'text', ts: ev.ts || Date.now(), content: ev.message }]);
            }
            break;
          case 'tool_call':
            setLogs(prev => [
              ...prev,
              { type: 'tool_call', ts: ev.ts || Date.now(), toolName: ev.toolName || ev.tool || ev.name || 'unknown-tool', callId: ev.callId, args: ev.args ?? ev.input },
            ]);
            break;
          case 'tool_result':
            setLogs(prev => [
              ...prev,
              { type: 'tool_result', ts: ev.ts || Date.now(), toolName: ev.toolName || ev.tool || ev.name || 'unknown-tool', callId: ev.callId, result: ev.result ?? ev.output },
            ]);
            break;
          case 'diff':
            setLogs(prev => [
              ...prev,
              { type: 'diff', ts: ev.ts || Date.now(), file: ev.file || ev.path || '', patch: ev.patch ?? ev.patchText ?? ev.diff, summary: ev.summary },
            ]);
            break;
          case 'file_write':
            setLogs(prev => [
              ...prev,
              { type: 'file_write', ts: ev.ts || Date.now(), path: ev.path || '', bytes: ev.bytes },
            ]);
            break;
          case 'metric':
            setLogs(prev => [
              ...prev,
              { type: 'metric', ts: ev.ts || Date.now(), key: ev.key || '', value: ev.value ?? 0, unit: ev.unit },
            ]);
            break;
          case 'artifact':
            setLogs(prev => [
              ...prev,
              { type: 'artifact', ts: ev.ts || Date.now(), kind: ev.kind || 'artifact', content: ev.content },
            ]);
            break;
          case 'error':
            setLogs(prev => [...prev, { type: 'text', ts: ev.ts || Date.now(), level: 'error', content: `error: ${ev.message || 'Unknown error'}` }]);
            setIsRunning(false);
            break;
          case 'done':
            setLogs(prev => [...prev, { type: 'text', ts: ev.ts || Date.now(), content: ev.success ? 'Agent run completed' : 'Agent run ended with errors' }]);
            setIsRunning(false);
            if (unsubscribeRef.current) {
              unsubscribeRef.current();
              unsubscribeRef.current = null;
            }
            break;
          default:
            setLogs(prev => [...prev, `event: ${JSON.stringify(ev)}`]);
        }
      });
    } catch (error) {
      setLogs(prev => [...prev, `Error starting agent: ${error instanceof Error ? error.message : 'Unknown error'}`]);
      setIsRunning(false);
    }
  };

  const handleCancel = async () => {
    if (!currentTaskId) return;
    try {
      await window.electronAPI.agentCancel(currentTaskId);
    } catch { }
    setIsRunning(false);
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    };
  }, []);

  return (
    <Flex height="100%">
      {/* Left pane - Task details */}
      <Box width="50%" className="border-r border-gray-6" overflowY="auto">
        <Box p="6">
          <Heading size="5" mb="4">{task.title}</Heading>

          <DataList.Root>
            <DataList.Item>
              <DataList.Label>Status</DataList.Label>
              <DataList.Value>
                <Badge color="gray">
                  {task.current_stage || 'Backlog'}
                </Badge>
              </DataList.Value>
            </DataList.Item>

            {task.repository_config && (
              <DataList.Item>
                <DataList.Label>Remote Repository</DataList.Label>
                <DataList.Value>
                  {task.repository_config.organization}/{task.repository_config.repository}
                </DataList.Value>
              </DataList.Item>
            )}

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
                {format(new Date(task.created_at), 'PPP p')}
              </DataList.Value>
            </DataList.Item>

            <DataList.Item>
              <DataList.Label>Description</DataList.Label>
              <DataList.Value>
                {task.description || 'No description provided'}
              </DataList.Value>
            </DataList.Item>

            <DataList.Item>
              <DataList.Label>Working Directory</DataList.Label>
              <DataList.Value>
                {repoPath ? (
                  <Text size="2">{repoPath}</Text>
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
                  onValueChange={(value) => setRunMode(value as 'local' | 'cloud')}
                >
                  <SegmentedControl.Item value="local">Local</SegmentedControl.Item>
                  <SegmentedControl.Item value="cloud">Cloud</SegmentedControl.Item>
                </SegmentedControl.Root>
              </DataList.Value>
            </DataList.Item>
          </DataList.Root>

          <Box mt="6">
            <Flex direction="column" gap="3">

              {!repoPath ? (
                <Button
                  variant='classic'
                  onClick={handleSelectRepo}
                  size="3"
                >
                  Choose working folder
                </Button>
              ) : (
                <Button
                  variant='classic'
                  onClick={handleRunTask}
                  disabled={isRunning}
                  size="3"
                >
                  {isRunning ? 'Running...' : 'Run Agent'}
                </Button>
              )}

              {isRunning && (
                <Button
                  onClick={handleCancel}
                  color="red"
                  size="3"
                >
                  Cancel
                </Button>
              )}
            </Flex>
          </Box>
        </Box>
      </Box>

      {/* Right pane - Logs */}
      <Box width="50%" className="bg-panel-solid">
        <LogView logs={logs} isRunning={isRunning} />
      </Box>
    </Flex>
  );
}