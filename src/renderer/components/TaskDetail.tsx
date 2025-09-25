import React, { useState } from 'react';
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
  const [logs, setLogs] = useState<string[]>([]);
  
  const handleRunTask = async (mode: 'local' | 'cloud') => {
    if (!client || isRunning) return;
    
    setIsRunning(true);
    setLogs([`Starting task in ${mode} mode...`]);
    
    try {
      // TODO: The run endpoint might not be implemented yet
      // For now, simulate the task execution
      
      // Simulate API call
      setLogs(prev => [...prev, `Initializing ${mode} agent...`]);
      
      // Simulate some task execution logs
      setTimeout(() => {
        setLogs(prev => [...prev, `Agent started successfully`]);
      }, 1000);
      
      setTimeout(() => {
        setLogs(prev => [...prev, `Analyzing task: ${task.title}`]);
      }, 2000);
      
      setTimeout(() => {
        setLogs(prev => [...prev, `Executing task...`]);
        setLogs(prev => [...prev, `> Setting up environment`]);
        setLogs(prev => [...prev, `> Running analysis`]);
      }, 3000);
      
      setTimeout(() => {
        setLogs(prev => [...prev, `Task execution in progress...`]);
        setLogs(prev => [...prev, `Note: This is a simulated execution. The actual API endpoint for running tasks needs to be implemented.`]);
      }, 4000);
      
      // Stop after 10 seconds (for demo)
      setTimeout(() => {
        setIsRunning(false);
        setLogs(prev => [...prev, `Task completed successfully (simulated)`]);
      }, 10000);
      
    } catch (error) {
      setLogs(prev => [...prev, `Error: ${error instanceof Error ? error.message : 'Unknown error'}`]);
      setIsRunning(false);
    }
  };
  
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
            <div className="pt-4 space-y-2">
              <button
                onClick={() => handleRunTask('local')}
                disabled={isRunning}
                className="w-full py-2 px-4 bg-posthog-500 hover:bg-posthog-600 disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-medium rounded-md transition-colors"
              >
                {isRunning ? 'Running...' : 'Run Local Agent'}
              </button>
              
              <button
                onClick={() => handleRunTask('cloud')}
                disabled={isRunning}
                className="w-full py-2 px-4 bg-dark-surface hover:bg-dark-border disabled:bg-gray-700 disabled:cursor-not-allowed text-dark-text font-medium rounded-md transition-colors"
              >
                {isRunning ? 'Running...' : 'Run Cloud Agent'}
              </button>
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