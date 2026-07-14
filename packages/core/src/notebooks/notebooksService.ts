import type {
  NotebookMarkdownSaveResponse,
  PostHogAPIClient,
} from "@posthog/api-client/posthog-client";
import { injectable } from "inversify";
import { buildMarkdownNotebookContent } from "./notebookContent";
import { notebooksStore } from "./notebooksStore";
import {
  type NotebookListItem,
  type NotebookRecord,
  notebookListItemSchema,
} from "./schemas";

export type MarkdownSaveResult = NotebookMarkdownSaveResponse;

/**
 * Portable notebooks domain service over the PostHog cloud Notebooks REST
 * API. Callers pass the authenticated PostHogAPIClient (the UI supplies it
 * from useAuthenticatedClient()); the service keeps the notebooks domain
 * store in sync. Merge/replay of markdown-save conflicts lives next to the
 * editor (it needs the editor's document model); markdownSave just returns
 * the structured saved/conflict/gone outcome.
 */
@injectable()
export class NotebooksService {
  async listNotebooks(client: PostHogAPIClient): Promise<NotebookListItem[]> {
    notebooksStore.getState().setNotebooksLoading(true);
    try {
      const notebooks = await client.listNotebooks();
      notebookListItemSchema.parse(notebooks);
      notebooksStore.getState().setNotebooks(notebooks);
      notebooksStore.getState().setNotebooksError(null);
      return notebooks;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      notebooksStore.getState().setNotebooksError(message);
      throw error;
    } finally {
      notebooksStore.getState().setNotebooksLoading(false);
    }
  }

  async getNotebook(
    client: PostHogAPIClient,
    shortId: string,
  ): Promise<NotebookRecord> {
    return await client.getNotebook(shortId);
  }

  async createNotebook(
    client: PostHogAPIClient,
    input: { title?: string; markdown?: string },
  ): Promise<NotebookRecord> {
    const markdown = input.markdown ?? "";
    const notebook = await client.createNotebook({
      ...(input.title !== undefined ? { title: input.title } : {}),
      content: buildMarkdownNotebookContent(markdown),
      text_content: markdown,
    });
    notebooksStore.getState().upsertNotebook(toListItem(notebook));
    return notebook;
  }

  // Title-only update — content never travels through PATCH for markdown
  // notebooks, so the envelope can't be clobbered outside the collab save.
  async updateTitle(
    client: PostHogAPIClient,
    shortId: string,
    title: string,
  ): Promise<NotebookRecord> {
    const notebook = await client.patchNotebook(shortId, { title });
    notebooksStore.getState().upsertNotebook(toListItem(notebook));
    return notebook;
  }

  async deleteNotebook(
    client: PostHogAPIClient,
    shortId: string,
  ): Promise<void> {
    await client.deleteNotebook(shortId);
    notebooksStore.getState().removeNotebook(shortId);
  }

  /**
   * Save a markdown edit through the collab endpoint. `version` is the
   * baseline notebook version the edit was derived from. Returns:
   * - `saved` with the updated notebook (bumped version),
   * - `conflict` with the missed remote updates to replay/merge (409),
   * - `gone` when the missed range is unrecoverable (410) — reload the
   *   notebook.
   */
  async markdownSave(
    client: PostHogAPIClient,
    shortId: string,
    input: {
      clientId: string;
      version: number;
      markdown: string;
      nodeId: string;
      title?: string;
    },
  ): Promise<MarkdownSaveResult> {
    const result = await client.notebookMarkdownSave(shortId, {
      client_id: input.clientId,
      version: input.version,
      content: buildMarkdownNotebookContent(input.markdown, input.nodeId),
      text_content: input.markdown,
      ...(input.title !== undefined ? { title: input.title } : {}),
    });
    if (result.status === "saved") {
      notebooksStore.getState().upsertNotebook(toListItem(result.notebook));
    }
    return result;
  }
}

function toListItem(notebook: NotebookRecord): NotebookListItem {
  return {
    id: notebook.id,
    short_id: notebook.short_id,
    title: notebook.title ?? null,
    deleted: notebook.deleted ?? false,
    created_at: notebook.created_at,
    created_by: notebook.created_by,
    last_modified_at: notebook.last_modified_at,
    last_modified_by: notebook.last_modified_by,
    user_access_level: notebook.user_access_level,
  };
}
