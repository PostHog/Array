import { describe, expect, it, vi } from "vitest";
import type { DesktopFsClient, FsEntryBase } from "../canvas/desktopFsClient";
import { RecentsService } from "./recentsService";

function serviceWith(rows: Array<FsEntryBase & Record<string, unknown>>) {
  const listByQuery = vi.fn(async () => rows);
  const getEntry = vi.fn(async (id: string) => ({
    id,
    path: `Canvases/${id}`,
    type: "dashboard",
    ref: null,
  }));
  const fetch = vi.fn(async () => new Response(null, { status: 204 }));
  const fs = { listByQuery, getEntry, fetch } as unknown as DesktopFsClient;
  return { service: new RecentsService(fs), listByQuery, getEntry, fetch };
}

describe("RecentsService", () => {
  it("returns the latest 20 task and canvas engagements from the backend", async () => {
    const rows = Array.from({ length: 24 }, (_, index) => ({
      id: `row-${index}`,
      path: `Space/Item ${index}`,
      type: index % 2 === 0 ? "task" : "dashboard",
      ref: `entity-${index}`,
      last_viewed_at: new Date(index * 1_000).toISOString(),
      meta: { channelId: "channel-1", templateId: "freeform" },
    }));
    const { service, listByQuery } = serviceWith(rows);

    const result = await service.list();

    expect(listByQuery).toHaveBeenCalledWith(
      "order_by=-last_viewed_at&limit=100&not_type=folder",
      "recent items",
    );
    expect(result).toHaveLength(20);
    expect(result[0]).toMatchObject({ id: "entity-23", kind: "canvas" });
    expect(result.at(-1)).toMatchObject({ id: "entity-4", kind: "task" });
  });

  it("makes a canvas hydratable before logging its engagement", async () => {
    const { service, fetch } = serviceWith([]);

    await service.record({ kind: "canvas", id: "canvas-1" });

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "canvas-1/",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ ref: "canvas-1" }),
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "log_view/",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ type: "dashboard", ref: "canvas-1" }),
      }),
    );
  });

  it("logs task engagement without rewriting its existing file-system row", async () => {
    const { service, getEntry, fetch } = serviceWith([]);

    await service.record({ kind: "task", id: "task-1" });

    expect(getEntry).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(
      "log_view/",
      expect.objectContaining({
        body: JSON.stringify({ type: "task", ref: "task-1" }),
      }),
    );
  });

  it("does not rewrite a non-canvas row supplied as a canvas id", async () => {
    const { service, getEntry, fetch } = serviceWith([]);
    getEntry.mockResolvedValue({
      id: "task-row",
      path: "Tasks/task-row",
      type: "task",
      ref: "task-row",
    } as never);

    await expect(
      service.record({ kind: "canvas", id: "task-row" }),
    ).rejects.toThrow("Canvas not found");

    expect(fetch).not.toHaveBeenCalled();
  });
});
