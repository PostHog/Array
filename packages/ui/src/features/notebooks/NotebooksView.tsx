import { Notebook, Plus } from "@phosphor-icons/react";
import { NotebooksService } from "@posthog/core/notebooks/notebooksService";
import type { NotebookListItem } from "@posthog/core/notebooks/schemas";
import { useService } from "@posthog/di/react";
import {
  Button,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Spinner,
} from "@posthog/quill";
import { useAuthenticatedClient } from "@posthog/ui/features/auth/authClient";
import { navigateToNotebook } from "@posthog/ui/router/navigationBridge";
import { Flex, ScrollArea, Text } from "@radix-ui/themes";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { NOTEBOOKS_QUERY_KEY, useNotebooks } from "./useNotebooks";

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function NotebooksView() {
  const client = useAuthenticatedClient();
  const service = useService(NotebooksService);
  const queryClient = useQueryClient();
  const { data: notebooks, isLoading, error } = useNotebooks();

  const createNotebook = useMutation({
    mutationFn: () => service.createNotebook(client, {}),
    onSuccess: (notebook) => {
      void queryClient.invalidateQueries({ queryKey: NOTEBOOKS_QUERY_KEY });
      navigateToNotebook(notebook.short_id);
    },
  });

  return (
    <Flex direction="column" className="h-full min-h-0 flex-1">
      <Flex
        align="center"
        justify="between"
        className="shrink-0 border-(--gray-4) border-b px-4 py-3"
      >
        <Text size="3" weight="bold">
          Notebooks
        </Text>
        <Button
          variant="primary"
          size="sm"
          onClick={() => createNotebook.mutate()}
          disabled={createNotebook.isPending}
        >
          {createNotebook.isPending ? (
            <Spinner className="size-4" />
          ) : (
            <Plus size={14} />
          )}
          New notebook
        </Button>
      </Flex>

      <ScrollArea className="min-h-0 flex-1">
        {isLoading ? (
          <Flex align="center" justify="center" className="py-16">
            <Spinner className="size-5" />
          </Flex>
        ) : error ? (
          <Empty className="mx-auto max-w-md py-16">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Notebook />
              </EmptyMedia>
              <EmptyTitle>Couldn&apos;t load notebooks</EmptyTitle>
              <EmptyDescription>
                {error instanceof Error ? error.message : "Unknown error"}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : !notebooks || notebooks.length === 0 ? (
          <Empty className="mx-auto max-w-md py-16">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Notebook />
              </EmptyMedia>
              <EmptyTitle>No notebooks yet</EmptyTitle>
              <EmptyDescription>
                Notebooks combine markdown notes with live PostHog insights.
                Create one to get started.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="mx-auto w-full max-w-3xl px-4 py-3">
            {notebooks.map((notebook) => (
              <NotebookRow key={notebook.short_id} notebook={notebook} />
            ))}
          </div>
        )}
      </ScrollArea>
    </Flex>
  );
}

function NotebookRow({ notebook }: { notebook: NotebookListItem }) {
  return (
    <button
      type="button"
      onClick={() => navigateToNotebook(notebook.short_id)}
      className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left hover:bg-(--gray-3)"
    >
      <Notebook size={18} className="shrink-0 text-(--gray-9)" />
      <Flex direction="column" className="min-w-0 flex-1">
        <Text size="2" weight="medium" className="truncate">
          {notebook.title || "Untitled"}
        </Text>
      </Flex>
      <Text size="1" color="gray" className="shrink-0">
        {relativeTime(notebook.last_modified_at)}
      </Text>
    </button>
  );
}
