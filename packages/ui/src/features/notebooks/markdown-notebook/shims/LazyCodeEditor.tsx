import type { JSX } from "react";

/**
 * Stand-in for posthog's Monaco-based `lib/monaco/CodeEditor`, used only by
 * the MarkdownNotebook debug "source drawer". A plain textarea honoring
 * value/onChange keeps the drawer functional without pulling in Monaco;
 * `language`, `height`, and Monaco `options` are accepted and ignored.
 */
export interface LazyCodeEditorProps {
  language?: string;
  value?: string;
  onChange?: (value: string | undefined) => void;
  height?: string | number;
  options?: Record<string, unknown>;
}

export function LazyCodeEditor({
  language: _language,
  value,
  onChange,
  height,
  options: _options,
}: LazyCodeEditorProps): JSX.Element {
  return (
    <textarea
      className="block h-full w-full resize-none border-0 bg-transparent p-2 font-mono text-xs outline-none"
      style={{ height }}
      value={value ?? ""}
      onChange={(event) => onChange?.(event.target.value)}
      spellCheck={false}
      aria-label="Markdown source"
    />
  );
}
