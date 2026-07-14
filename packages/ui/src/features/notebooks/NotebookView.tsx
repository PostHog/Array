import { ArrowLeft, Notebook as NotebookIcon } from "@phosphor-icons/react";
import type { PostHogAPIClient } from "@posthog/api-client/posthog-client";
import {
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
import { useAuthenticatedClient } from "@posthog/ui/features/auth/authClient";
import { navigateToNotebooks } from "@posthog/ui/router/navigationBridge";
import { Flex, IconButton, ScrollArea, Text } from "@radix-ui/themes";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { MarkdownNotebook } from "./markdown-notebook/MarkdownNotebook";
import { getNotebooksAppRegistry } from "./notebookRegistry";
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
    return (
      <Flex align="center" justify="center" className="h-full flex-1">
        <Empty className="mx-auto max-w-md">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <NotebookIcon />
            </EmptyMedia>
            <EmptyTitle>Legacy notebook format</EmptyTitle>
            <EmptyDescription>
              This notebook uses the older rich-text format. Open it in PostHog
              and convert it to a Markdown notebook to edit it here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </Flex>
    );
  }

  return <NotebookEditor notebook={notebook} />;
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
  const registry = useMemo(() => getNotebooksAppRegistry(), []);

  // The engine's deps close over the latest client without recreating the
  // engine (the authenticated client's identity changes on auth-state churn).
  const clientRef = useRef<PostHogAPIClient>(client);
  clientRef.current = client;

  // The engine is created (and disposed) inside an effect rather than a
  // useMemo: StrictMode's dev double-mount runs the cleanup once against the
  // first mount, and a memoized engine would stay permanently disposed while
  // the surviving render kept handing out its dead callbacks.
  const [engine, setEngine] = useState<NotebookSyncEngine | null>(null);
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
    setEngine(nextEngine);
    return () => {
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
      </Flex>

      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto w-full max-w-4xl px-6 py-6">
          {engine ? (
            <MarkdownNotebook
              value={value}
              onChange={(markdown) => {
                setValue(markdown);
                engine.handleChange(markdown);
              }}
              mode="edit"
              registry={registry}
              clientId={engine.clientId}
              remoteValue={remote?.markdown}
              remoteVersion={remote?.version}
              placeholder="Start writing, or press / to insert…"
              autoFocus
            />
          ) : null}
        </div>
      </ScrollArea>
    </Flex>
  );
}
