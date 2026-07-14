import type { PostHogAPIClient } from "@posthog/api-client/posthog-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildMarkdownNotebookContent,
  getMarkdownNotebookMarkdown,
  getMarkdownNotebookNodeId,
  isMarkdownNotebookContent,
  MARKDOWN_NOTEBOOK_NODE_TYPE,
} from "./notebookContent";
import { NotebooksService } from "./notebooksService";
import { notebooksStore } from "./notebooksStore";
import type { NotebookListItem, NotebookRecord } from "./schemas";

function notebook(overrides: Partial<NotebookRecord> = {}): NotebookRecord {
  return {
    id: "nb-uuid",
    short_id: "abc123",
    title: "My notebook",
    content: buildMarkdownNotebookContent("# Hi", "node-1"),
    version: 3,
    created_at: "2026-07-01T00:00:00Z",
    last_modified_at: "2026-07-02T00:00:00Z",
    user_access_level: "editor",
    ...overrides,
  } as NotebookRecord;
}

function listItem(overrides: Partial<NotebookListItem> = {}): NotebookListItem {
  return {
    id: "nb-uuid",
    short_id: "abc123",
    title: "My notebook",
    deleted: false,
    created_at: "2026-07-01T00:00:00Z",
    last_modified_at: "2026-07-02T00:00:00Z",
    user_access_level: "editor",
    ...overrides,
  } as NotebookListItem;
}

function fakeClient(overrides: Partial<PostHogAPIClient>): PostHogAPIClient {
  return overrides as PostHogAPIClient;
}

beforeEach(() => {
  notebooksStore.setState({
    notebooks: [],
    notebooksLoading: false,
    notebooksError: null,
  });
});

describe("notebookContent envelope helpers", () => {
  it("round-trips markdown through the envelope", () => {
    const content = buildMarkdownNotebookContent("# Title\n\nBody", "node-42");

    expect(isMarkdownNotebookContent(content)).toBe(true);
    expect(getMarkdownNotebookMarkdown(content)).toBe("# Title\n\nBody");
    expect(getMarkdownNotebookNodeId(content)).toBe("node-42");
  });

  it("generates a nodeId when none is given", () => {
    const content = buildMarkdownNotebookContent("hello");

    const nodeId = getMarkdownNotebookNodeId(content);
    expect(nodeId).toBeTruthy();
    expect(getMarkdownNotebookMarkdown(content)).toBe("hello");
  });

  it.each([
    ["null", null],
    ["a string", "# raw markdown"],
    ["an array", [{ type: MARKDOWN_NOTEBOOK_NODE_TYPE }]],
    ["an empty doc", { type: "doc", content: [] }],
    [
      "an old-format TipTap doc",
      {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "hi" }] },
        ],
      },
    ],
    [
      "a doc with extra nodes beside the markdown node",
      {
        type: "doc",
        content: [
          { type: MARKDOWN_NOTEBOOK_NODE_TYPE, attrs: { markdown: "hi" } },
          { type: "paragraph" },
        ],
      },
    ],
  ])("does not treat %s as a markdown notebook", (_label, content) => {
    expect(isMarkdownNotebookContent(content)).toBe(false);
    expect(getMarkdownNotebookMarkdown(content)).toBeNull();
    expect(getMarkdownNotebookNodeId(content)).toBeNull();
  });

  it("falls back to empty markdown and the default nodeId when attrs are missing", () => {
    const content = {
      type: "doc",
      content: [{ type: MARKDOWN_NOTEBOOK_NODE_TYPE }],
    };

    expect(isMarkdownNotebookContent(content)).toBe(true);
    expect(getMarkdownNotebookMarkdown(content)).toBe("");
    expect(getMarkdownNotebookNodeId(content)).toBe("markdown-notebook-v2");
  });
});

describe("NotebooksService.listNotebooks", () => {
  it("populates the store and clears loading/error", async () => {
    const rows = [listItem(), listItem({ short_id: "def456", title: null })];
    const client = fakeClient({ listNotebooks: vi.fn(async () => rows) });
    const service = new NotebooksService();

    const result = await service.listNotebooks(client);

    expect(result).toEqual(rows);
    expect(notebooksStore.getState().notebooks).toEqual(rows);
    expect(notebooksStore.getState().notebooksLoading).toBe(false);
    expect(notebooksStore.getState().notebooksError).toBeNull();
  });

  it("records the error and rethrows when validation fails", async () => {
    const client = fakeClient({
      listNotebooks: vi.fn(
        async () => [{ title: "missing short_id" }] as NotebookListItem[],
      ),
    });
    const service = new NotebooksService();

    await expect(service.listNotebooks(client)).rejects.toThrow();
    expect(notebooksStore.getState().notebooksError).not.toBeNull();
    expect(notebooksStore.getState().notebooksLoading).toBe(false);
    expect(notebooksStore.getState().notebooks).toEqual([]);
  });
});

describe("NotebooksService.createNotebook", () => {
  it("sends a markdown envelope with text_content and upserts the store", async () => {
    const created = notebook({ short_id: "new123", title: "Fresh" });
    const createNotebook = vi.fn(
      async (_body: {
        title?: string;
        content?: unknown;
        text_content?: string;
      }) => created,
    );
    const service = new NotebooksService();

    const result = await service.createNotebook(
      fakeClient({ createNotebook }),
      { title: "Fresh", markdown: "# Fresh" },
    );

    expect(result).toBe(created);
    const [body] = createNotebook.mock.calls[0];
    expect(body.title).toBe("Fresh");
    expect(body.text_content).toBe("# Fresh");
    expect(isMarkdownNotebookContent(body.content)).toBe(true);
    expect(getMarkdownNotebookMarkdown(body.content)).toBe("# Fresh");
    expect(notebooksStore.getState().notebooks[0]?.short_id).toBe("new123");
  });
});

describe("NotebooksService.updateTitle", () => {
  it("patches the title only and updates the store row", async () => {
    notebooksStore.getState().setNotebooks([listItem()]);
    const patched = notebook({ title: "Renamed" });
    const patchNotebook = vi.fn(async () => patched);
    const service = new NotebooksService();

    await service.updateTitle(
      fakeClient({ patchNotebook }),
      "abc123",
      "Renamed",
    );

    expect(patchNotebook).toHaveBeenCalledWith("abc123", { title: "Renamed" });
    expect(notebooksStore.getState().notebooks).toHaveLength(1);
    expect(notebooksStore.getState().notebooks[0]?.title).toBe("Renamed");
  });
});

describe("NotebooksService.deleteNotebook", () => {
  it("removes the notebook from the store", async () => {
    notebooksStore
      .getState()
      .setNotebooks([listItem(), listItem({ short_id: "keep1" })]);
    const deleteNotebook = vi.fn(async () => {});
    const service = new NotebooksService();

    await service.deleteNotebook(fakeClient({ deleteNotebook }), "abc123");

    expect(deleteNotebook).toHaveBeenCalledWith("abc123");
    expect(notebooksStore.getState().notebooks.map((n) => n.short_id)).toEqual([
      "keep1",
    ]);
  });
});

describe("NotebooksService.markdownSave", () => {
  const input = {
    clientId: "client-1",
    version: 3,
    markdown: "# Edited",
    nodeId: "node-1",
  };

  it("sends the envelope and upserts the store on saved", async () => {
    const saved = notebook({ version: 4, title: "My notebook" });
    const notebookMarkdownSave = vi.fn(
      async (
        _shortId: string,
        _body: {
          client_id: string;
          version: number;
          content: unknown;
          text_content?: string;
        },
      ) => ({ status: "saved" as const, notebook: saved }),
    );
    const service = new NotebooksService();

    const result = await service.markdownSave(
      fakeClient({ notebookMarkdownSave }),
      "abc123",
      input,
    );

    expect(result).toEqual({ status: "saved", notebook: saved });
    const [shortId, body] = notebookMarkdownSave.mock.calls[0];
    expect(shortId).toBe("abc123");
    expect(body.client_id).toBe("client-1");
    expect(body.version).toBe(3);
    expect(body.text_content).toBe("# Edited");
    expect(getMarkdownNotebookMarkdown(body.content)).toBe("# Edited");
    expect(getMarkdownNotebookNodeId(body.content)).toBe("node-1");
    expect(notebooksStore.getState().notebooks[0]?.short_id).toBe("abc123");
  });

  it.each([
    [
      "conflict",
      {
        status: "conflict" as const,
        serverVersion: 5,
        updates: [
          {
            version: 4,
            diff: [{ start: 0, end: 1, text: "x" }],
            base_crc: null,
          },
        ],
      },
    ],
    ["gone", { status: "gone" as const }],
  ])(
    "passes through a %s result without touching the store",
    async (_label, response) => {
      const notebookMarkdownSave = vi.fn(async () => response);
      const service = new NotebooksService();

      const result = await service.markdownSave(
        fakeClient({ notebookMarkdownSave }),
        "abc123",
        input,
      );

      expect(result).toEqual(response);
      expect(notebooksStore.getState().notebooks).toEqual([]);
    },
  );
});
