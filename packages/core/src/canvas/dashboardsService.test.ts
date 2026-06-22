import { describe, expect, it, vi } from "vitest";
import { DashboardsService } from "./dashboardsService";
import type { DesktopFsClient, FsEntryBase } from "./desktopFsClient";

// A dashboard FS row carrying our payload under `meta`, as the backend returns it.
function dashboardRow(
  id: string,
  name: string,
  channelId: string,
  updatedAt: number,
): FsEntryBase & { meta: Record<string, unknown> } {
  return {
    id,
    path: `Channels/${channelId}/${name}`,
    type: "dashboard",
    meta: { channelId, updatedAt, templateId: "dashboard", spec: null },
  };
}

// A fake DesktopFsClient exposing only the two methods `list` touches:
// getEntry (to resolve the channel folder path) and listByQuery (the filtered
// fetch). listByQuery is declared with explicit params so spy calls carry args.
function fakeFs(rows: FsEntryBase[]) {
  const listByQuery = vi.fn(
    async (_query: string, _errorLabel: string): Promise<FsEntryBase[]> => rows,
  );
  const fs = {
    getEntry: async (id: string) => ({ id, path: `Channels/${id}` }),
    listByQuery,
  };
  return { fs: fs as unknown as DesktopFsClient, listByQuery };
}

describe("DashboardsService.list", () => {
  it("fetches with a parent-scoped, type-filtered query", async () => {
    const { fs, listByQuery } = fakeFs([]);
    const service = new DashboardsService(fs, {} as never);

    await service.list("chan-1");

    expect(listByQuery).toHaveBeenCalledTimes(1);
    const [query] = listByQuery.mock.calls[0];
    expect(query).toContain("parent=");
    expect(query).toContain(encodeURIComponent("Channels/chan-1"));
    expect(query).toContain("type=dashboard");
  });

  it("maps rows to summaries sorted by updatedAt descending", async () => {
    const { fs } = fakeFs([
      dashboardRow("a", "Older", "chan-1", 100),
      dashboardRow("b", "Newer", "chan-1", 300),
      dashboardRow("c", "Middle", "chan-1", 200),
    ]);
    const service = new DashboardsService(fs, {} as never);

    const result = await service.list("chan-1");

    expect(result.map((d) => d.id)).toEqual(["b", "c", "a"]);
    expect(result[0]).toMatchObject({ name: "Newer", channelId: "chan-1" });
  });
});

// Fake exposing getEntry (resolves the row to rename) + fetch (the PATCH).
function fakeFsForRename(entry: FsEntryBase) {
  const fetch = vi.fn(async (_path: string, init?: RequestInit) => ({
    ok: true,
    status: 200,
    json: async () => ({
      ...entry,
      path: JSON.parse((init?.body as string) ?? "{}").path ?? entry.path,
    }),
  }));
  const fs = {
    getEntry: async () => entry,
    fetch,
  };
  return { fs: fs as unknown as DesktopFsClient, fetch };
}

describe("DashboardsService.rename", () => {
  it("PATCHes a new last path segment built from the name", async () => {
    const entry = dashboardRow("d1", "Untitled canvas", "chan-1", 100);
    const { fs, fetch } = fakeFsForRename(entry);
    const service = new DashboardsService(fs, {} as never);

    const result = await service.rename({ id: "d1", name: "Churn by plan" });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [, init] = fetch.mock.calls[0];
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse((init?.body as string) ?? "{}").path).toBe(
      "Channels/chan-1/Churn by plan",
    );
    expect(result.name).toBe("Churn by plan");
  });

  it("no-ops (no fetch) when the name resolves to the same path", async () => {
    const entry = dashboardRow("d1", "Same name", "chan-1", 100);
    const { fs, fetch } = fakeFsForRename(entry);
    const service = new DashboardsService(fs, {} as never);

    const result = await service.rename({ id: "d1", name: "Same name" });

    expect(fetch).not.toHaveBeenCalled();
    expect(result.name).toBe("Same name");
  });
});
