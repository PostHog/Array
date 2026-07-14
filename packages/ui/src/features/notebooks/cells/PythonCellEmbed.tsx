import { useOptionalAuthenticatedClient } from "@posthog/ui/features/auth/authClient";
import { Code } from "lucide-react";
import type { JSX } from "react";
import { useEffect, useRef, useState } from "react";
import type {
  NotebookComponentRenderProps,
  NotebookPropValue,
} from "../markdown-notebook/types";
import { CellCodeEditor } from "./CellCodeEditor";
import {
  CellError,
  CellFrame,
  CellHint,
  CellOutputBlock,
  RunCellButton,
} from "./cellBlocks";
import {
  buildErrorExecution,
  buildMediaSource,
  type CellExecution,
  formatTraceback,
  isSessionOnlyEndpointError,
  KERNEL_SESSION_ONLY_MESSAGE,
  normalizeKernelExecution,
  stripAnsi,
} from "./cellExecution";
import { useNotebookCellContext } from "./NotebookCellContext";

interface LiveRun {
  stdout: string;
  stderr: string;
}

/**
 * Runnable `<Python code/>` cell: CodeMirror python editor, streamed
 * stdout/stderr while the kernel executes, and the final execution dict
 * persisted into `pythonExecution` so results survive reload and sync to
 * other clients (matching the PostHog webapp's Python node).
 */
export function PythonCellEmbed({
  node,
  updateProps,
}: NotebookComponentRenderProps): JSX.Element {
  const cellContext = useNotebookCellContext();
  const client = useOptionalAuthenticatedClient();
  const code = typeof node.props.code === "string" ? node.props.code : "";
  const title =
    typeof node.props.title === "string" && node.props.title.trim()
      ? node.props.title
      : "Python";

  const [live, setLive] = useState<LiveRun | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const running = live !== null;
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  // Refs so the Mod-Enter handler and stream callbacks see current values.
  const codeRef = useRef(code);
  codeRef.current = code;

  const persistExecution = (execution: unknown): void => {
    updateProps({
      pythonExecution: execution as NotebookPropValue,
    });
  };

  const run = async (): Promise<void> => {
    if (!client || !cellContext || abortRef.current?.signal.aborted === false) {
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setRunError(null);
    setLive({ stdout: "", stderr: "" });
    let sawTerminalFrame = false;
    try {
      await client.notebookKernelExecuteStream(
        cellContext.shortId,
        { code: codeRef.current },
        {
          signal: controller.signal,
          onEvent: (event) => {
            let payload: Record<string, unknown> | null = null;
            try {
              const parsed: unknown = JSON.parse(event.data);
              payload =
                parsed && typeof parsed === "object" && !Array.isArray(parsed)
                  ? (parsed as Record<string, unknown>)
                  : null;
            } catch {
              payload = null;
            }
            if (event.event === "stdout" || event.event === "stderr") {
              const stream = event.event as "stdout" | "stderr";
              const text =
                typeof payload?.text === "string" ? payload.text : "";
              if (!text) return;
              setLive((current) =>
                current
                  ? {
                      ...current,
                      [stream]: current[stream] + text,
                    }
                  : current,
              );
            } else if (event.event === "result") {
              sawTerminalFrame = true;
              persistExecution(payload);
            } else if (event.event === "error") {
              sawTerminalFrame = true;
              const message =
                typeof payload?.error === "string"
                  ? payload.error
                  : "Execution failed";
              persistExecution(buildErrorExecution(message));
            }
          },
        },
      );
      if (!sawTerminalFrame) {
        setRunError("The kernel stream ended without a result.");
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setRunError(
          isSessionOnlyEndpointError(error)
            ? KERNEL_SESSION_ONLY_MESSAGE
            : error instanceof Error
              ? error.message
              : "Execution failed",
        );
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setLive(null);
      }
    }
  };

  const execution = normalizeKernelExecution(node.props.pythonExecution);
  const disabledReason = !cellContext
    ? "This cell can only run inside a notebook."
    : !client
      ? "Sign in to PostHog to run this cell."
      : null;

  return (
    <CellFrame
      icon={<Code />}
      title={title}
      actions={
        <RunCellButton
          running={running}
          disabled={disabledReason !== null}
          disabledReason={disabledReason}
          onRun={() => void run()}
        />
      }
    >
      <CellCodeEditor
        value={code}
        language="python"
        placeholder="Write Python — Cmd/Ctrl+Enter runs the cell"
        onChange={(value) => updateProps({ code: value })}
        onRun={() => void run()}
      />
      {disabledReason ? <CellHint>{disabledReason}</CellHint> : null}
      {running ? (
        <div className="flex flex-col gap-2">
          {!live.stdout && !live.stderr ? (
            <CellHint>
              Running… the kernel boots on first run, which can take up to a
              minute.
            </CellHint>
          ) : null}
          {live.stdout ? (
            <CellOutputBlock title="Output" text={stripAnsi(live.stdout)} />
          ) : null}
          {live.stderr ? (
            <CellOutputBlock
              title="stderr"
              tone="danger"
              text={stripAnsi(live.stderr)}
            />
          ) : null}
        </div>
      ) : (
        <PythonExecutionOutput execution={execution} />
      )}
      {runError && !running ? <CellError>{runError}</CellError> : null}
    </CellFrame>
  );
}

function PythonExecutionOutput({
  execution,
}: {
  execution: CellExecution | null;
}): JSX.Element | null {
  if (!execution) return null;
  const hasAnyOutput =
    execution.stdout ||
    execution.stderr ||
    execution.resultText ||
    execution.media.length > 0 ||
    execution.traceback.length > 0;
  if (!hasAnyOutput) {
    return <CellHint>Ran without output.</CellHint>;
  }
  return (
    <div className="flex flex-col gap-2">
      {execution.stdout ? (
        <CellOutputBlock title="Output" text={stripAnsi(execution.stdout)} />
      ) : null}
      {execution.stderr ? (
        <CellOutputBlock
          title="stderr"
          tone="danger"
          text={stripAnsi(execution.stderr)}
        />
      ) : null}
      {execution.resultText ? (
        <CellOutputBlock title="Result" text={execution.resultText} />
      ) : null}
      {execution.media.map((media, index) => {
        const source = buildMediaSource(media);
        if (!source) return null;
        return (
          <img
            // biome-ignore lint/suspicious/noArrayIndexKey: media items are positional
            key={index}
            src={source}
            alt="Python output"
            className="max-w-full rounded border border-(--gray-4)"
          />
        );
      })}
      {execution.status === "error" && execution.traceback.length > 0 ? (
        <CellOutputBlock
          title={execution.errorName ?? "Error"}
          tone="danger"
          text={formatTraceback(execution.traceback)}
        />
      ) : null}
    </div>
  );
}
