import type { Task } from "@posthog/shared/domain-types";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@posthog/di/container", () => ({
  resolveService: vi.fn(),
}));

import { resolveService } from "@posthog/di/container";
import { HOST_TRPC_CLIENT } from "@posthog/host-router/client";
import { IMPERATIVE_QUERY_CLIENT } from "../../shell/queryClient";
import { navigationTaskBinder } from "./taskBinderImpl";

function makeHost(overrides?: {
  workspaces?: Record<string, unknown>;
  folders?: unknown[];
}) {
  return {
    workspace: {
      getAll: { query: vi.fn(async () => overrides?.workspaces ?? {}) },
      create: { mutate: vi.fn(async () => undefined) },
      ensureScratchDir: {
        mutate: vi.fn(async () => ({ path: "/scratch/t1" })),
      },
    },
    folders: {
      getFolders: { query: vi.fn(async () => overrides?.folders ?? []) },
      getRepositoryByRemoteUrl: { query: vi.fn(async () => null) },
      addFolder: { mutate: vi.fn(async () => undefined) },
    },
  };
}

const queryClientFake = { invalidateQueries: vi.fn(async () => undefined) };

function wire(host: ReturnType<typeof makeHost>) {
  vi.mocked(resolveService).mockImplementation((token) => {
    if (token === HOST_TRPC_CLIENT) return host;
    if (token === IMPERATIVE_QUERY_CLIENT) return queryClientFake;
    // Anything else (e.g. the shell logger's HOST_LOGGER) is unbound in this
    // harness; throwing matches an unbound container and the logger no-ops.
    throw new Error(`unbound token in test: ${String(token)}`);
  });
}

describe("navigationTaskBinder.ensureWorkspaceForTask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("provisions a scratch dir for a repo-less local task with no workspace", async () => {
    const host = makeHost();
    wire(host);
    const task = { id: "t1", repository: null } as unknown as Task;

    await navigationTaskBinder.ensureWorkspaceForTask(task);

    expect(host.workspace.ensureScratchDir.mutate).toHaveBeenCalledWith({
      taskId: "t1",
    });
    expect(host.workspace.create.mutate).not.toHaveBeenCalled();
    expect(queryClientFake.invalidateQueries).toHaveBeenCalled();
  });

  it("leaves an existing scratch workspace alone", async () => {
    const host = makeHost({
      workspaces: { t1: { taskId: "t1", isScratch: true } },
    });
    wire(host);
    const task = { id: "t1", repository: null } as unknown as Task;

    await navigationTaskBinder.ensureWorkspaceForTask(task);

    expect(host.workspace.ensureScratchDir.mutate).not.toHaveBeenCalled();
  });

  it("does not provision scratch for a repo task with no resolvable directory", async () => {
    const host = makeHost();
    wire(host);
    const task = {
      id: "t1",
      repository: "posthog/code",
    } as unknown as Task;

    await navigationTaskBinder.ensureWorkspaceForTask(task);

    expect(host.workspace.ensureScratchDir.mutate).not.toHaveBeenCalled();
    expect(host.workspace.create.mutate).not.toHaveBeenCalled();
  });
});
