import React, { useEffect, useRef } from 'react';
import clsx from 'clsx';

interface LogViewProps {
  logs: string[];
  isRunning: boolean;
}

export function LogView({ logs, isRunning }: LogViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  
  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);
  
  if (logs.length === 0 && !isRunning) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8">
        <div className="text-dark-text-muted text-center">
          <p className="mb-2">No activity yet</p>
          <p className="text-sm">Run the task to see logs here</p>
        </div>
      </div>
    );
  }
  
  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-dark-border flex items-center justify-between">
        <h2 className="font-medium text-dark-text">Activity Log</h2>
        {isRunning && (
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
            <span className="text-sm text-dark-text-muted">Running</span>
          </div>
        )}
      </div>
      
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 font-mono text-sm"
      >
        {logs.map((log, index) => (
          <div
            key={index}
            className={clsx(
              'mb-2 leading-relaxed',
              log.startsWith('Error') ? 'text-red-400' : 'text-dark-text'
            )}
          >
            <span className="text-dark-text-muted mr-2">
              {new Date().toLocaleTimeString()}
            </span>
            {log}
          </div>
        ))}
      </div>
    </div>
  );
}