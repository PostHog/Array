export type LogEntry =
  | { type: 'text'; ts: number; content: string; level?: 'info' | 'warn' | 'error' }
  | { type: 'status'; ts: number; phase: 'queued' | 'planning' | 'executing' | 'tool' | 'finalizing' | 'done' }
  | { type: 'tool_call'; ts: number; toolName: string; callId?: string; args?: unknown }
  | { type: 'tool_result'; ts: number; toolName: string; callId?: string; result?: unknown }
  | { type: 'diff'; ts: number; file: string; patch?: string; summary?: { added: number; removed: number } }
  | { type: 'file_write'; ts: number; path: string; bytes?: number }
  | { type: 'metric'; ts: number; key: string; value: number; unit?: string }
  | { type: 'artifact'; ts: number; kind: string; content?: unknown };

export function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString();
  } catch {
    return '';
  }
}

