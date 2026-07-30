import type { Task } from "@posthog/shared/domain-types";
import { useAuthenticatedQuery } from "@posthog/ui/hooks/useAuthenticatedQuery";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useChannelFeed } from "./useChannelFeed";

const mocks = vi.hoisted(() => ({
  archivedTaskIds: new Set<string>(),
}));

vi.mock("@posthog/ui/hooks/useAuthenticatedQuery", () => ({
  useAuthenticatedQuery: vi.fn(() => ({ data: [], isLoading: false })),
}));
vi.mock("@posthog/ui/features/archive/useArchivedTaskIds", () => ({
  useArchivedTaskIds: () => mocks.archivedTaskIds,
}));

function task(id: string, createdAt: string): Task {
  return {
    id,
    task_number: null,
    slug: id,
    title: id,
    description: "",
    created_at: createdAt,
    updated_at: createdAt,
    origin_product: "code",
  };
}

describe("useChannelFeed", () => {
  beforeEach(() => {
    mocks.archivedTaskIds = new Set<string>();
    vi.mocked(useAuthenticatedQuery).mockReturnValue({
      data: [],
      isLoading: false,
    } as never);
  });

  function feedOf(tasks: Task[]) {
    vi.mocked(useAuthenticatedQuery).mockReturnValue({
      data: tasks,
      isLoading: false,
    } as never);
    return renderHook(() => useChannelFeed("channel-id")).result.current.tasks;
  }

  it("orders the feed oldest first", () => {
    const tasks = feedOf([
      task("newer", "2026-07-28T12:00:00Z"),
      task("older", "2026-07-27T12:00:00Z"),
    ]);

    expect(tasks.map((t) => t.id)).toEqual(["older", "newer"]);
  });

  // Archiving is local, so the cloud feed keeps returning the task: without
  // this filter an archived task's card never leaves the space.
  it("drops archived tasks", () => {
    mocks.archivedTaskIds = new Set(["archived"]);

    const tasks = feedOf([
      task("archived", "2026-07-27T12:00:00Z"),
      task("kept", "2026-07-28T12:00:00Z"),
    ]);

    expect(tasks.map((t) => t.id)).toEqual(["kept"]);
  });

  it("leaves the query cache untouched when filtering", () => {
    const data = [task("archived", "2026-07-27T12:00:00Z")];
    mocks.archivedTaskIds = new Set(["archived"]);

    feedOf(data);

    expect(data.map((t) => t.id)).toEqual(["archived"]);
  });
});
