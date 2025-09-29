import React, { useState } from 'react';

interface ToolCallViewProps {
  toolName: string;
  callId?: string;
  args?: unknown;
}

function stringify(value: unknown, maxLength = 2000): string {
  try {
    const s = JSON.stringify(value, null, 2);
    if (!s) return '';
    return s.length > maxLength ? s.slice(0, maxLength) + '…' : s;
  } catch {
    const s = String(value ?? '');
    return s.length > maxLength ? s.slice(0, maxLength) + '…' : s;
  }
}

export function ToolCallView({ toolName, callId, args }: ToolCallViewProps) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="border border-dark-border rounded-md overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-dark-bg">
        <div className="text-dark-text">
          <span className="font-medium">{toolName}</span>
          {callId ? <span className="text-dark-text-muted ml-2">[{callId}]</span> : null}
        </div>
        <button
          className="text-xs px-2 py-1 bg-dark-surface hover:bg-dark-border rounded text-dark-text"
          onClick={() => setExpanded(v => !v)}
        >
          {expanded ? 'Hide args' : 'Show args'}
        </button>
      </div>
      {expanded && args !== undefined && (
        <pre className="whitespace-pre-wrap p-3 text-sm text-dark-text bg-dark-surface overflow-x-auto">
{stringify(args)}
        </pre>
      )}
    </div>
  );
}


