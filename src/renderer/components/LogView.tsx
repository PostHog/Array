import React, { useEffect, useRef } from 'react';
import clsx from 'clsx';
import { LogEntry, formatTime } from '../types/log';
import { ToolCallView } from './log/ToolCallView';
import { DiffView } from './log/DiffView';
import { MetricView } from './log/MetricView';

interface LogViewProps {
  logs: Array<string | LogEntry>;
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
      
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 font-mono text-sm whitespace-pre-wrap">
        {logs.map((log, index) => {
          // Backward compat for plain strings
          if (typeof log === 'string') {
            return (
              <div key={index} className={clsx('mb-2 leading-relaxed text-dark-text')}>
                <span className="text-dark-text-muted mr-2">{new Date().toLocaleTimeString()}</span>
                {log}
              </div>
            );
          }
          // Structured entries
          switch (log.type) {
            case 'text':
              return (
                <div key={index} className={clsx('mb-2 leading-relaxed', log.level === 'error' ? 'text-red-400' : 'text-dark-text')}>
                  <span className="text-dark-text-muted mr-2">{formatTime(log.ts)}</span>
                  {log.content}
                </div>
              );
            case 'status':
              return (
                <div key={index} className="mb-2 leading-relaxed text-dark-text">
                  <span className="text-dark-text-muted mr-2">{formatTime(log.ts)}</span>
                  status: {log.phase}
                </div>
              );
            case 'tool_call':
              return (
                <div key={index} className="mb-4">
                  <div className="text-xs text-dark-text-muted mb-1">{formatTime(log.ts)} tool_call</div>
                  <ToolCallView toolName={log.toolName} callId={log.callId} args={log.args} />
                </div>
              );
            case 'tool_result':
              return (
                <div key={index} className="mb-4">
                  <div className="text-xs text-dark-text-muted mb-1">{formatTime(log.ts)} tool_result</div>
                  <ToolCallView toolName={log.toolName} callId={log.callId} args={log.result} />
                </div>
              );
            case 'diff':
              return (
                <div key={index} className="mb-4">
                  <div className="text-xs text-dark-text-muted mb-1">{formatTime(log.ts)} diff</div>
                  <DiffView file={log.file} patch={log.patch} added={log.summary?.added} removed={log.summary?.removed} />
                </div>
              );
            case 'file_write':
              return (
                <div key={index} className="mb-2 leading-relaxed text-dark-text">
                  <span className="text-dark-text-muted mr-2">{formatTime(log.ts)}</span>
                  file_write: {log.path}
                  {typeof log.bytes === 'number' ? <span className="text-dark-text-muted"> ({log.bytes} bytes)</span> : null}
                </div>
              );
            case 'metric':
              return (
                <div key={index} className="mb-2">
                  <div className="text-xs text-dark-text-muted mb-1">{formatTime(log.ts)} metric</div>
                  <MetricView keyName={log.key} value={log.value} unit={log.unit} />
                </div>
              );
            case 'artifact':
              return (
                <div key={index} className="mb-2 leading-relaxed text-dark-text">
                  <span className="text-dark-text-muted mr-2">{formatTime(log.ts)}</span>
                  artifact: {/* simple preview */}
                </div>
              );
            default:
              return (
                <div key={index} className="mb-2 leading-relaxed text-dark-text">
                  <span className="text-dark-text-muted mr-2">{new Date().toLocaleTimeString()}</span>
                  {JSON.stringify(log)}
                </div>
              );
          }
        })}
      </div>
    </div>
  );
}