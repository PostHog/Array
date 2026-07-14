import { Button, Input } from "@posthog/quill";
import { Loader2, Play } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

/** Card shell shared by the runnable cells (Python / SQL / SQL v2). */
export function CellFrame({
  icon,
  title,
  actions,
  children,
}: {
  icon?: ReactNode;
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-(--gray-4) p-3">
      <div className="flex items-center gap-2">
        {icon ? (
          <span className="flex size-4 shrink-0 items-center justify-center text-(--gray-9) [&>svg]:size-4">
            {icon}
          </span>
        ) : null}
        <span className="min-w-0 flex-1 truncate font-medium text-(--gray-12) text-sm">
          {title}
        </span>
        {actions}
      </div>
      {children}
    </div>
  );
}

export function RunCellButton({
  running,
  disabled,
  disabledReason,
  onRun,
}: {
  running: boolean;
  disabled?: boolean;
  disabledReason?: string | null;
  onRun: () => void;
}) {
  return (
    <Button
      variant="primary"
      size="xs"
      disabled={running || disabled}
      title={disabledReason ?? "Run (Cmd/Ctrl+Enter)"}
      onClick={onRun}
    >
      {running ? <Loader2 className="animate-spin" /> : <Play />}
      Run
    </Button>
  );
}

/** Labelled monospace output block (stdout / stderr / result / traceback). */
export function CellOutputBlock({
  title,
  tone = "default",
  text,
}: {
  title: string;
  tone?: "default" | "danger";
  text: string;
}) {
  return (
    <div>
      <div className="text-(--gray-9) text-[10px] uppercase tracking-wide">
        {title}
      </div>
      <pre
        className={`mt-1 max-h-64 select-text overflow-auto whitespace-pre-wrap rounded bg-(--gray-2) p-2 font-mono text-xs ${
          tone === "danger" ? "text-(--red-11)" : "text-(--gray-12)"
        }`}
      >
        {text}
      </pre>
    </div>
  );
}

export function CellHint({ children }: { children: ReactNode }) {
  return <div className="text-(--gray-9) text-xs">{children}</div>;
}

export function CellError({ children }: { children: ReactNode }) {
  return <div className="break-words text-(--red-11) text-xs">{children}</div>;
}

/**
 * Editable "return variable" footer input, committed on blur/Enter so a
 * half-typed identifier never lands in the persisted markdown.
 */
export function ReturnVariableInput({
  value,
  placeholder,
  onCommit,
}: {
  value: string;
  placeholder: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);
  const commit = () => {
    const next = draft.trim();
    if (next !== value) onCommit(next);
  };
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="shrink-0 text-(--gray-9)">Return variable</span>
      <Input
        value={draft}
        placeholder={placeholder}
        aria-label="Return variable"
        className="h-6 w-40 font-mono text-xs"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
          event.stopPropagation();
        }}
      />
    </div>
  );
}
