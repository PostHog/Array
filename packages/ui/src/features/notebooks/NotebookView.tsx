import {
  ArrowLeft,
  Cpu,
  Notebook as NotebookIcon,
} from "@phosphor-icons/react";
import type { PostHogAPIClient } from "@posthog/api-client/posthog-client";
import {
  buildMarkdownNotebookContent,
  getMarkdownNotebookMarkdown,
  getMarkdownNotebookNodeId,
  isMarkdownNotebookContent,
} from "@posthog/core/notebooks/notebookContent";
import { NotebooksService } from "@posthog/core/notebooks/notebooksService";
import type { NotebookRecord } from "@posthog/core/notebooks/schemas";
import { useService } from "@posthog/di/react";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Spinner,
} from "@posthog/quill";
import {
  useAuthenticatedClient,
  useOptionalAuthenticatedClient,
} from "@posthog/ui/features/auth/authClient";
import { navigateToNotebooks } from "@posthog/ui/router/navigationBridge";
import { Flex, IconButton, ScrollArea, Text } from "@radix-ui/themes";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { KernelPanel } from "./cells/KernelPanel";
import { NotebookCellContextProvider } from "./cells/NotebookCellContext";
import {
  convertNotebookContentToMarkdown,
  type NotebookContentForMarkdownConversion,
} from "./markdown-notebook/legacyConversion";
import { MarkdownNotebook } from "./markdown-notebook/MarkdownNotebook";
import type {
  MarkdownNotebookCaretPosition,
  RemoteNotebookCaret,
} from "./markdown-notebook/remoteCarets";
import { NotebookInlineAIController } from "./notebookInlineAI";
import { getNotebooksAppRegistry } from "./notebookRegistry";
import { NotebookStreamController } from "./notebookStream";
import { NotebookSyncEngine, type NotebookSyncStatus } from "./notebookSync";
import { useNotebook } from "./useNotebook";
import { NOTEBOOKS_QUERY_KEY } from "./useNotebooks";

const STATUS_LABEL: Record<NotebookSyncStatus, string> = {
  saved: "Saved",
  dirty: "Unsaved changes",
  saving: "Saving…",
  error: "Offline — retrying",
};

interface NotebookViewProps {
  shortId: string;
}

export function NotebookView({ shortId }: NotebookViewProps) {
  const { data: notebook, isLoading, error } = useNotebook(shortId);

  if (isLoading) {
    return (
      <Flex align="center" justify="center" className="h-full flex-1">
        <Spinner className="size-5" />
      </Flex>
    );
  }

  if (error || !notebook) {
    return (
      <Flex align="center" justify="center" className="h-full flex-1">
        <Empty className="mx-auto max-w-md">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <NotebookIcon />
            </EmptyMedia>
            <EmptyTitle>Couldn&apos;t open notebook</EmptyTitle>
            <EmptyDescription>
              {error instanceof Error ? error.message : "Notebook not found."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </Flex>
    );
  }

  if (!isMarkdownNotebookContent(notebook.content)) {
    return <LegacyNotebookConverter notebook={notebook} />;
  }

  return <NotebookEditor notebook={notebook} />;
}

// Legacy (TipTap rich-text) notebooks are converted to markdown in place the
// first time they're opened here: convert the content JSON client-side, PATCH
// the notebook with the markdown envelope, then refetch so NotebookView
// remounts the editor on the fresh (now-markdown) notebook.
function LegacyNotebookConverter({ notebook }: { notebook: NotebookRecord }) {
  const client = useOptionalAuthenticatedClient();
  const queryClient = useQueryClient();
  const [conversionError, setConversionError] = useState<string | null>(null);

  // The conversion must fire exactly once per mount, even across StrictMode's
  // dev double-effect and auth-state re-renders (the ref survives both).
  const conversionStartedRef = useRef(false);
  useEffect(() => {
    if (!client || conversionStartedRef.current) {
      return;
    }
    conversionStartedRef.current = true;
    void (async () => {
      try {
        const markdown = convertNotebookContentToMarkdown(
          notebook.content as NotebookContentForMarkdownConversion,
        );
        await client.patchNotebook(notebook.short_id, {
          content: buildMarkdownNotebookContent(markdown),
          text_content: markdown,
          version: notebook.version ?? 0,
        });
        // Refetch so NotebookView re-renders with the markdown notebook (and
        // its server-bumped version) and mounts the editor.
        await queryClient.invalidateQueries({
          queryKey: ["notebook", notebook.short_id],
        });
      } catch (error) {
        setConversionError(
          error instanceof Error ? error.message : String(error),
        );
      }
    })();
  }, [client, notebook, queryClient]);

  if (conversionError) {
    return (
      <Flex align="center" justify="center" className="h-full flex-1">
        <Empty className="mx-auto max-w-md">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <NotebookIcon />
            </EmptyMedia>
            <EmptyTitle>Legacy notebook format</EmptyTitle>
            <EmptyDescription>
              This notebook uses the older rich-text format and couldn&apos;t be
              converted to Markdown automatically: {conversionError}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </Flex>
    );
  }

  return (
    <Flex align="center" justify="center" gap="2" className="h-full flex-1">
      <Spinner className="size-5" />
      <Text size="2" color="gray">
        Converting notebook to Markdown…
      </Text>
    </Flex>
  );
}

function NotebookEditor({ notebook }: { notebook: NotebookRecord }) {
  const client = useAuthenticatedClient();
  const service = useService(NotebooksService);
  const queryClient = useQueryClient();

  const initialMarkdown = getMarkdownNotebookMarkdown(notebook.content) ?? "";
  const initialNodeId = getMarkdownNotebookNodeId(notebook.content);

  const [value, setValue] = useState(initialMarkdown);
  const [remote, setRemote] = useState<{
    markdown: string;
    version: number;
  } | null>(null);
  const [status, setStatus] = useState<NotebookSyncStatus>("saved");
  const [title, setTitle] = useState(notebook.title ?? "");
  const [remoteCarets, setRemoteCarets] = useState<RemoteNotebookCaret[]>([]);
  const [showKernelPanel, setShowKernelPanel] = useState(false);
  const [aiWritingNodeIndexes, setAiWritingNodeIndexes] = useState<number[]>(
    [],
  );
  const [focusAIPromptRequest, setFocusAIPromptRequest] = useState(0);
  const registry = useMemo(() => getNotebooksAppRegistry(), []);

  // The engine's deps close over the latest client without recreating the
  // engine (the authenticated client's identity changes on auth-state churn).
  const clientRef = useRef<PostHogAPIClient>(client);
  clientRef.current = client;
  // Synchronous mirrors of the latest editor value/title, so the AI runner
  // reads the current document even between React commits.
  const valueRef = useRef(initialMarkdown);
  const titleRef = useRef(notebook.title ?? "");
  titleRef.current = title;

  // The engine is created (and disposed) inside an effect rather than a
  // useMemo: StrictMode's dev double-mount runs the cleanup once against the
  // first mount, and a memoized engine would stay permanently disposed while
  // the surviving render kept handing out its dead callbacks.
  const [engine, setEngine] = useState<NotebookSyncEngine | null>(null);
  const streamRef = useRef<NotebookStreamController | null>(null);
  const aiRef = useRef<NotebookInlineAIController | null>(null);
  useEffect(() => {
    const nextEngine = new NotebookSyncEngine(
      {
        markdown: initialMarkdown,
        version: notebook.version ?? 0,
        nodeId: initialNodeId ?? globalThis.crypto.randomUUID(),
      },
      {
        saveMarkdown: async (input) => {
          const result = await service.markdownSave(
            clientRef.current,
            notebook.short_id,
            input,
          );
          if (result.status === "saved") {
            return {
              status: "saved",
              markdown:
                getMarkdownNotebookMarkdown(result.notebook.content) ??
                input.markdown,
              version: result.notebook.version ?? input.version + 1,
            };
          }
          return result;
        },
        reload: async () => {
          const fresh = await service.getNotebook(
            clientRef.current,
            notebook.short_id,
          );
          return {
            markdown: getMarkdownNotebookMarkdown(fresh.content) ?? "",
            version: fresh.version ?? 0,
            nodeId: getMarkdownNotebookNodeId(fresh.content),
          };
        },
        onRemoteContent: setRemote,
        onStatusChange: setStatus,
      },
    );
    // Realtime: SSE update/presence stream feeding the engine and the caret
    // overlay, plus the inline-AI runner that weaves Max AI responses into
    // the document (its writes flow through setMarkdown → the same autosave
    // path as user edits).
    const stream = new NotebookStreamController({
      shortId: notebook.short_id,
      clientId: nextEngine.clientId,
      engine: nextEngine,
      getClient: () => clientRef.current,
      onPresence: setRemoteCarets,
    });
    const ai = new NotebookInlineAIController({
      getClient: () => clientRef.current,
      getNotebookMeta: () => ({
        shortId: notebook.short_id,
        title: titleRef.current,
      }),
      getMarkdown: () => valueRef.current,
      setMarkdown: (markdown) => {
        valueRef.current = markdown;
        setValue(markdown);
        nextEngine.handleChange(markdown);
      },
      setWritingNodeIndexes: setAiWritingNodeIndexes,
      requestPromptFocus: () => setFocusAIPromptRequest((n) => n + 1),
    });
    streamRef.current = stream;
    aiRef.current = ai;
    setEngine(nextEngine);
    return () => {
      streamRef.current = null;
      aiRef.current = null;
      stream.dispose();
      ai.dispose();
      nextEngine.dispose({ flush: true });
    };
    // The route remounts this component per notebook (key=shortId) and the
    // query data is stable while mounted, so this runs once per open document.
  }, [
    initialMarkdown,
    initialNodeId,
    notebook.short_id,
    notebook.version,
    service,
  ]);

  const saveTitle = async (nextTitle: string) => {
    const trimmed = nextTitle.trim();
    if (trimmed === (notebook.title ?? "")) return;
    await service.updateTitle(clientRef.current, notebook.short_id, trimmed);
    void queryClient.invalidateQueries({ queryKey: NOTEBOOKS_QUERY_KEY });
  };

  return (
    <Flex direction="column" className="h-full min-h-0 flex-1">
      <Flex
        align="center"
        gap="2"
        className="shrink-0 border-(--gray-4) border-b px-3 py-2"
      >
        <IconButton
          variant="ghost"
          color="gray"
          size="1"
          onClick={navigateToNotebooks}
          aria-label="Back to notebooks"
        >
          <ArrowLeft size={14} />
        </IconButton>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => void saveTitle(title)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
          }}
          placeholder="Untitled"
          className="min-w-0 flex-1 bg-transparent font-semibold text-base outline-none placeholder:text-(--gray-8)"
        />
        <Text size="1" color="gray" className="shrink-0">
          {STATUS_LABEL[status]}
        </Text>
        <IconButton
          variant={showKernelPanel ? "solid" : "ghost"}
          color="gray"
          size="1"
          onClick={() => setShowKernelPanel((open) => !open)}
          aria-label="Kernel info"
        >
          <Cpu size={14} />
        </IconButton>
      </Flex>

      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto w-full max-w-4xl px-6 py-6">
          {showKernelPanel ? (
            <div className="mb-4">
              <KernelPanel shortId={notebook.short_id} />
            </div>
          ) : null}
          {engine ? (
            <NotebookCellContextProvider shortId={notebook.short_id}>
              <MarkdownNotebook
                value={value}
                onChange={(markdown) => {
                  const previous = valueRef.current;
                  valueRef.current = markdown;
                  setValue(markdown);
                  engine.handleChange(markdown);
                  // Remap active AI response ranges through the edit (no-ops
                  // for the AI runner's own writes echoed back by the editor).
                  aiRef.current?.handleDocumentChange(previous, markdown);
                }}
                mode="edit"
                registry={registry}
                clientId={engine.clientId}
                remoteValue={remote?.markdown}
                remoteVersion={remote?.version}
                remoteCarets={remoteCarets}
                onCaretChange={(
                  position: MarkdownNotebookCaretPosition | null,
                ) => streamRef.current?.publishCaret(position)}
                onAskAI={(request) => aiRef.current?.handleAskAI(request)}
                aiWritingNodeIndexes={aiWritingNodeIndexes}
                focusAIPromptRequest={focusAIPromptRequest}
                placeholder="Start writing, or press / to insert…"
                autoFocus
              />
            </NotebookCellContextProvider>
          ) : null}
        </div>
      </ScrollArea>
    </Flex>
  );
}
