import React from 'react';

interface DiffViewProps {
  file: string;
  patch?: string;
  added?: number;
  removed?: number;
}

function getFileParts(path: string): { dir: string; base: string } {
  if (!path) return { dir: '', base: '' };
  const idx = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  if (idx === -1) return { dir: '', base: path };
  return { dir: path.slice(0, idx + 1), base: path.slice(idx + 1) };
}

export function DiffView({ file, patch, added, removed }: DiffViewProps) {
  const { dir, base } = getFileParts(file);
  const lines = (patch || '').split(/\r?\n/);

  return (
    <div className="border border-dark-border rounded-md overflow-hidden">
      <div className="px-3 py-2 bg-dark-bg flex items-center justify-between">
        <div className="text-sm">
          <span className="text-dark-text-muted">{dir}</span>
          <span className="text-dark-text font-medium">{base}</span>
        </div>
        <div className="text-xs text-dark-text-muted">
          {typeof added === 'number' && typeof removed === 'number' ? (
            <span>+{added} / -{removed}</span>
          ) : null}
        </div>
      </div>
      <pre className="text-sm leading-relaxed whitespace-pre overflow-auto p-3 bg-dark-surface">
        {lines.map((line, i) => {
          let cls = 'text-dark-text';
          if (line.startsWith('+++') || line.startsWith('---')) cls = 'text-dark-text-muted';
          else if (line.startsWith('@@')) cls = 'text-blue-400';
          else if (line.startsWith('+')) cls = 'text-green-400';
          else if (line.startsWith('-')) cls = 'text-red-400';
          else if (line.startsWith('diff ') || line.startsWith('index ')) cls = 'text-dark-text-muted';
          return (
            <div key={i} className={cls}>{line || '\u00A0'}</div>
          );
        })}
      </pre>
    </div>
  );
}


