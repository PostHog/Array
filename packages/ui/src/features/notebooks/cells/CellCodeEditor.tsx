import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { python } from "@codemirror/lang-python";
import { sql } from "@codemirror/lang-sql";
import { EditorState, Prec } from "@codemirror/state";
import {
  EditorView,
  keymap,
  placeholder as placeholderExtension,
} from "@codemirror/view";
import {
  oneDark,
  oneLight,
} from "@posthog/ui/features/code-editor/theme/editorTheme";
import { useThemeStore } from "@posthog/ui/shell/themeStore";
import { useEffect, useMemo, useRef } from "react";

export interface CellCodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  language: "sql" | "python";
  /** Wired to Mod-Enter inside the editor. */
  onRun?: () => void;
  placeholder?: string;
}

const cellTheme = EditorView.theme({
  "&": { minHeight: "120px" },
  ".cm-content": { minHeight: "120px", padding: "8px 0" },
  ".cm-gutters": { display: "none" },
});

/**
 * Thin editable CodeMirror wrapper for runnable notebook cells, reusing the
 * repo's code-editor theme. The editor instance is created once per language/
 * theme; `value` and the callbacks sync through refs so parent re-renders
 * (e.g. our own onChange persisting props) never tear the editor down.
 */
export function CellCodeEditor({
  value,
  onChange,
  language,
  onRun,
  placeholder,
}: CellCodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const isDarkMode = useThemeStore((state) => state.isDarkMode);

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onRunRef = useRef(onRun);
  onRunRef.current = onRun;
  const valueRef = useRef(value);
  valueRef.current = value;

  const extensions = useMemo(() => {
    return [
      // Highest precedence so Mod-Enter beats the default newline binding.
      Prec.highest(
        keymap.of([
          {
            key: "Mod-Enter",
            run: () => {
              onRunRef.current?.();
              return true;
            },
          },
        ]),
      ),
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      language === "python" ? python() : sql(),
      EditorView.lineWrapping,
      isDarkMode ? oneDark : oneLight,
      cellTheme,
      ...(placeholder ? [placeholderExtension(placeholder)] : []),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) return;
        const next = update.state.doc.toString();
        valueRef.current = next;
        onChangeRef.current(next);
      }),
    ];
  }, [language, isDarkMode, placeholder]);

  useEffect(() => {
    if (!containerRef.current) return;
    viewRef.current?.destroy();
    viewRef.current = new EditorView({
      state: EditorState.create({ doc: valueRef.current, extensions }),
      parent: containerRef.current,
    });
    return () => {
      viewRef.current?.destroy();
      viewRef.current = null;
    };
  }, [extensions]);

  // Adopt external value changes (remote collab edits) without recreating.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
    }
  }, [value]);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: event fencing only — CodeMirror inside provides the interactive surface
    <div
      ref={containerRef}
      className="min-h-[120px] overflow-hidden rounded border border-(--gray-5) font-mono text-[13px]"
      // Keep typing and text selection inside the cell — the surrounding
      // notebook editor listens for both. Bubble phase (not capture) so
      // CodeMirror's own handlers on the content DOM run first.
      onMouseDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    />
  );
}
