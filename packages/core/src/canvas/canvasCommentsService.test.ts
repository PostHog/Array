import type { Schemas } from "@posthog/api-client/generated";
import type { PostHogAPIClient } from "@posthog/api-client/posthog-client";
import {
  CanvasCommentsService,
  groupThreads,
  parseCanvasComment,
} from "@posthog/core/canvas/canvasCommentsService";
import type { CanvasComment } from "@posthog/core/canvas/canvasCommentsSchemas";
import { describe, expect, it, vi } from "vitest";

function apiComment(overrides: Partial<Schemas.Comment> = {}): Schemas.Comment {
  return {
    id: "c1",
    created_by: {
      id: 1,
      uuid: "u-1",
      first_name: "Ada",
      last_name: "Lovelace",
      email: "ada@example.com",
      hedgehog_config: null,
    } as Schemas.Comment["created_by"],
    version: 0,
    created_at: "2026-07-01T10:00:00Z",
    content: "Looks off",
    scope: "code_canvas",
    item_id: "dash-1",
    ...overrides,
  };
}

describe("parseCanvasComment", () => {
  it("maps an anchored root comment", () => {
    const parsed = parseCanvasComment(
      apiComment({
        item_context: {
          version: 1,
          anchor: { type: "text", quote: "18%", prefix: "grew ", suffix: " q" },
        } as unknown as Schemas.Comment["item_context"],
      }),
    );
    expect(parsed).toMatchObject({
      id: "c1",
      content: "Looks off",
      createdBy: {
        uuid: "u-1",
        name: "Ada Lovelace",
        email: "ada@example.com",
      },
      anchor: { type: "text", quote: "18%", prefix: "grew ", suffix: " q" },
      sourceCommentId: null,
    });
    expect(parsed?.createdAt).toBe(Date.parse("2026-07-01T10:00:00Z"));
  });

  it("drops deleted rows", () => {
    expect(parseCanvasComment(apiComment({ deleted: true }))).toBeNull();
  });

  it("degrades an unparseable item_context to a null anchor", () => {
    const parsed = parseCanvasComment(
      apiComment({
        item_context: {
          version: 99,
          anchor: { type: "wat" },
        } as unknown as Schemas.Comment["item_context"],
      }),
    );
    expect(parsed?.anchor).toBeNull();
  });

  it("falls back to the email when the name is empty", () => {
    const parsed = parseCanvasComment(
      apiComment({
        created_by: {
          id: 2,
          uuid: "u-2",
          first_name: "",
          email: "no-name@example.com",
          hedgehog_config: null,
        } as Schemas.Comment["created_by"],
      }),
    );
    expect(parsed?.createdBy.name).toBe("no-name@example.com");
  });
});

describe("groupThreads", () => {
  function comment(overrides: Partial<CanvasComment>): CanvasComment {
    return {
      id: "x",
      content: "",
      createdAt: 0,
      createdBy: { uuid: "u", name: "U", email: "u@example.com" },
      anchor: null,
      sourceCommentId: null,
      ...overrides,
    };
  }

  it("groups replies under roots, oldest-first, with 1-based indexes", () => {
    const threads = groupThreads([
      comment({ id: "b", createdAt: 2 }),
      comment({ id: "a", createdAt: 1 }),
      comment({ id: "r2", createdAt: 4, sourceCommentId: "a" }),
      comment({ id: "r1", createdAt: 3, sourceCommentId: "a" }),
    ]);
    expect(threads.map((t) => t.root.id)).toEqual(["a", "b"]);
    expect(threads.map((t) => t.index)).toEqual([1, 2]);
    expect(threads[0]?.replies.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(threads[1]?.replies).toEqual([]);
  });

  it("promotes a reply whose root is missing to its own root", () => {
    const threads = groupThreads([
      comment({ id: "orphan", createdAt: 5, sourceCommentId: "gone" }),
    ]);
    expect(threads).toHaveLength(1);
    expect(threads[0]?.root.id).toBe("orphan");
  });
});

describe("CanvasCommentsService", () => {
  it("lists, filters deleted, and threads comments", async () => {
    const client = {
      listComments: vi.fn().mockResolvedValue([
        apiComment({ id: "root", created_at: "2026-07-01T10:00:00Z" }),
        apiComment({
          id: "reply",
          created_at: "2026-07-01T11:00:00Z",
          source_comment: "root",
        }),
        apiComment({ id: "zombie", deleted: true }),
      ]),
    } as unknown as PostHogAPIClient;
    const threads = await new CanvasCommentsService().listThreads(
      client,
      "dash-1",
    );
    expect(client.listComments).toHaveBeenCalledWith("code_canvas", "dash-1");
    expect(threads).toHaveLength(1);
    expect(threads[0]?.root.id).toBe("root");
    expect(threads[0]?.replies.map((r) => r.id)).toEqual(["reply"]);
  });

  it("creates roots with the anchor context and replies without one", async () => {
    const createComment = vi.fn().mockResolvedValue(apiComment());
    const patchComment = vi.fn().mockResolvedValue(apiComment());
    const client = {
      createComment,
      patchComment,
    } as unknown as PostHogAPIClient;
    const service = new CanvasCommentsService();

    await service.addComment(client, {
      dashboardId: "dash-1",
      content: "hm",
      anchor: { type: "page" },
      canvasVersionId: "v9",
    });
    expect(createComment).toHaveBeenCalledWith({
      content: "hm",
      scope: "code_canvas",
      item_id: "dash-1",
      item_context: {
        version: 1,
        anchor: { type: "page" },
        canvasVersionId: "v9",
      },
    });

    await service.addReply(client, {
      dashboardId: "dash-1",
      content: "agreed",
      rootId: "root-1",
    });
    expect(createComment).toHaveBeenCalledWith({
      content: "agreed",
      scope: "code_canvas",
      item_id: "dash-1",
      item_context: { version: 1 },
      source_comment: "root-1",
    });

    await service.remove(client, "c-9");
    expect(patchComment).toHaveBeenCalledWith("c-9", { deleted: true });
  });
});
