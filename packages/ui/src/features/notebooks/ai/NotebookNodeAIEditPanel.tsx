import { buildNotebookNodePropsUpdate } from "@posthog/core/notebooks/notebookNodeAIService";
import type { NotebookNodeJsonObject } from "@posthog/core/notebooks/notebookNodeSummary";
import { Button, Input, Textarea } from "@posthog/quill";
import { ChevronRight, Sparkles } from "lucide-react";
import { type JSX, type KeyboardEvent, useState } from "react";
import type { NotebookComponentRenderProps } from "../markdown-notebook/types";
import {
  useNotebookNodeAIChange,
  useNotebookNodeAISummary,
} from "./useNotebookNodeAI";

/**
 * Universal AI edit panel for PostHog entity nodes: a human-readable summary
 * of the node's current props (local heuristic instantly, AI streaming in
 * over it), a prompt box that applies natural-language change requests via a
 * single model call returning {props, summary}, and a collapsible raw-JSON
 * escape hatch that commits through the same shell `updateProps` plumbing as
 * the generic edit panel it replaces.
 */
export function NotebookNodeAIEditPanel({
  node,
  updateProps,
}: NotebookComponentRenderProps): JSX.Element {
  // NotebookComponentProps and NotebookNodeJsonObject are the same JSON shape;
  // core just owns its own name for it to stay UI-independent.
  const props = node.props as NotebookNodeJsonObject;
  const summaryState = useNotebookNodeAISummary(node.tagName, props);
  const change = useNotebookNodeAIChange(node.tagName);
  const [prompt, setPrompt] = useState("");
  const [rawOpen, setRawOpen] = useState(false);
  const [rawDraft, setRawDraft] = useState<string | null>(null);
  const [rawError, setRawError] = useState<string | null>(null);

  const submitPrompt = (): void => {
    const request = prompt.trim();
    if (!request || change.isPending) return;
    change.mutate(
      { props, request },
      {
        onSuccess: (result) => {
          updateProps(buildNotebookNodePropsUpdate(props, result.props));
          setPrompt("");
          setRawDraft(null);
          setRawError(null);
        },
      },
    );
  };

  const handlePromptKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submitPrompt();
    }
  };

  const rawValue = rawDraft ?? JSON.stringify(props, null, 2);
  const applyRawJson = (): void => {
    try {
      const parsed: unknown = JSON.parse(rawValue);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        setRawError("Props must be a JSON object.");
        return;
      }
      updateProps(
        buildNotebookNodePropsUpdate(props, parsed as NotebookNodeJsonObject),
      );
      setRawDraft(null);
      setRawError(null);
    } catch (error) {
      setRawError(error instanceof Error ? error.message : "Invalid JSON");
    }
  };

  const changeErrorMessage =
    change.error instanceof Error ? change.error.message : null;

  return (
    <div className="flex flex-col gap-2 p-2">
      <div className="flex items-start gap-2">
        <Sparkles
          className={`mt-0.5 size-4 shrink-0 ${
            summaryState.isAISummary ? "text-(--accent-9)" : "text-(--gray-8)"
          }`}
          aria-hidden
        />
        <p className="m-0 min-w-0 flex-1 text-(--gray-12) text-sm">
          {summaryState.summary}
          {summaryState.isStreaming ? (
            <span className="ml-1 inline-block animate-pulse text-(--gray-8)">
              ▍
            </span>
          ) : null}
        </p>
      </div>
      {summaryState.hasClient ? (
        <div className="flex items-center gap-2">
          <Input
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={handlePromptKeyDown}
            placeholder='Describe a change, e.g. "split by country, last 90 days"'
            aria-label="AI change request"
            disabled={change.isPending}
            className="flex-1"
          />
          <Button
            variant="primary"
            size="sm"
            onClick={submitPrompt}
            loading={change.isPending}
            disabled={change.isPending || !prompt.trim()}
          >
            Apply
          </Button>
        </div>
      ) : (
        <p className="m-0 text-(--gray-9) text-xs">
          Connect to PostHog to edit this block with AI.
        </p>
      )}
      {changeErrorMessage ? (
        <p className="m-0 text-(--red-11) text-xs">{changeErrorMessage}</p>
      ) : null}
      <div>
        <button
          type="button"
          className="flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-(--gray-9) text-xs hover:text-(--gray-11)"
          onClick={() => setRawOpen((open) => !open)}
          aria-expanded={rawOpen}
        >
          <ChevronRight
            className={`size-3 transition-transform ${rawOpen ? "rotate-90" : ""}`}
            aria-hidden
          />
          Raw JSON
        </button>
        {rawOpen ? (
          <div className="mt-1 flex flex-col gap-1">
            <Textarea
              value={rawValue}
              onChange={(event) => {
                setRawDraft(event.target.value);
                setRawError(null);
              }}
              spellCheck={false}
              rows={Math.min(14, rawValue.split("\n").length + 1)}
              className="font-mono text-xs"
              aria-label={`${node.tagName} props JSON`}
            />
            <div className="flex items-center justify-between gap-2">
              {rawError ? (
                <span className="text-(--red-11) text-xs">{rawError}</span>
              ) : (
                <span className="text-(--gray-9) text-xs">Component props</span>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={applyRawJson}
                disabled={rawDraft === null}
              >
                Apply JSON
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
