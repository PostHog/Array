import React, { useEffect, useRef, useState } from 'react';
import { Task } from '@shared/types';
import { format } from 'date-fns';
import { useAuthStore } from '../stores/authStore';
import { LogView } from './LogView';

interface TaskDetailProps {
  task: Task;
}

export function TaskDetail({ task }: TaskDetailProps) {
  const { client } = useAuthStore();
  const [isRunning, setIsRunning] = useState(false);
  const [logs, setLogs] = useState<any[]>([]);
  const [repoPath, setRepoPath] = useState<string | null>(null);
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
  const unsubscribeRef = useRef<null | (() => void)>(null);
  const [runMode, setRunMode] = useState<'local' | 'cloud'>('local');
  
  // Safely stringify values for log preview
  const previewJson = (value: any, maxLength: number = 600): string => {
    try {
      const serialized = JSON.stringify(value, null, 2);
      if (!serialized) return '';
      return serialized.length > maxLength
        ? serialized.slice(0, maxLength) + '…'
        : serialized;
    } catch {
      try {
        const str = String(value);
        return str.length > maxLength ? str.slice(0, maxLength) + '…' : str;
      } catch {
        return '';
      }
    }
  };
  
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
      setLogs(prev => [...prev, 'No repository folder selected.']);
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
    } catch {}
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
    <div className="flex flex-1 h-full">
      {/* Left pane - Task details */}
      <div className="w-1/2 border-r border-dark-border overflow-y-auto">
        <div className="p-6">
          <h1 className="text-2xl font-bold text-dark-text mb-4">{task.title}</h1>
          
          <div className="space-y-4">
            {/* Status */}
            <div>
              <h3 className="text-sm font-medium text-dark-text-muted mb-1">Status</h3>
              <span className="px-3 py-1 bg-dark-surface rounded-md text-dark-text">
                {task.current_stage || 'Backlog'}
              </span>
            </div>
            
            {/* Repository */}
            {task.repository_config && (
              <div>
                <h3 className="text-sm font-medium text-dark-text-muted mb-1">Repository</h3>
                <p className="text-dark-text font-mono text-sm">
                  {task.repository_config.organization}/{task.repository_config.repository}
                </p>
              </div>
            )}
            
            {/* GitHub Links */}
            {(task.github_branch || task.github_pr_url) && (
              <div>
                <h3 className="text-sm font-medium text-dark-text-muted mb-1">GitHub</h3>
                {task.github_branch && (
                  <p className="text-dark-text text-sm">Branch: {task.github_branch}</p>
                )}
                {task.github_pr_url && (
                  <a 
                    href={task.github_pr_url} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-posthog-400 hover:text-posthog-300 text-sm"
                  >
                    View Pull Request →
                  </a>
                )}
              </div>
            )}
            
            {/* Dates */}
            <div>
              <h3 className="text-sm font-medium text-dark-text-muted mb-1">Created</h3>
              <p className="text-dark-text text-sm">
                {format(new Date(task.created_at), 'PPP p')}
              </p>
            </div>
            
            {/* Description */}
            <div>
              <h3 className="text-sm font-medium text-dark-text-muted mb-2">Description</h3>
              <div className="bg-dark-surface rounded-md p-4">
                <p className="text-dark-text whitespace-pre-wrap">
                  {task.description || 'No description provided'}
                </p>
              </div>
            </div>
            
            {/* Actions */}
            <div className="pt-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs text-dark-text-muted truncate">
                  {repoPath ? `Repo: ${repoPath}` : 'No repository selected'}
                </div>
                <button
                  onClick={handleSelectRepo}
                  className="py-1 px-2 bg-dark-surface hover:bg-dark-border text-dark-text text-xs rounded-md"
                >
                  Choose folder
                </button>
              </div>

              <div className="flex items-center gap-2">
                <div className="text-xs text-dark-text-muted">Mode</div>
                <div className="inline-flex rounded-md overflow-hidden border border-dark-border">
                  <button
                    onClick={() => setRunMode('local')}
                    className={`px-3 py-1 text-sm ${runMode === 'local' ? 'bg-posthog-500 text-white' : 'bg-dark-surface text-dark-text hover:bg-dark-border'}`}
                  >
                    Local
                  </button>
                  <button
                    onClick={() => setRunMode('cloud')}
                    className={`px-3 py-1 text-sm border-l border-dark-border ${runMode === 'cloud' ? 'bg-posthog-500 text-white' : 'bg-dark-surface text-dark-text hover:bg-dark-border'}`}
                  >
                    Cloud
                  </button>
                </div>
              </div>

              <button
                onClick={handleRunTask}
                disabled={isRunning}
                className="w-full py-2 px-4 bg-posthog-500 hover:bg-posthog-600 disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-medium rounded-md transition-colors"
              >
                {isRunning ? 'Running...' : 'Run Agent'}
              </button>

              {isRunning && (
                <button
                  onClick={handleCancel}
                  className="w-full py-2 px-4 bg-red-600 hover:bg-red-700 text-white font-medium rounded-md transition-colors"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      
      {/* Right pane - Logs */}
      <div className="w-1/2 bg-dark-surface">
        <LogView logs={logs} isRunning={isRunning} />
      </div>
    </div>
  );
}