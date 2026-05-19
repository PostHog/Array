import { beforeEach, describe, expect, it, vi } from "vitest";
import { FileWatcherEvent } from "./schemas";

vi.mock("../../utils/logger.js", () => ({
  logger: {
    scope: () => ({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

vi.mock("@parcel/watcher", () => ({ subscribe: vi.fn() }));

import type { WatcherRegistryService } from "../watcher-registry/service";
import { FileWatcherService } from "./service";

interface PendingChanges {
  dirs: Set<string>;
  files: Set<string>;
  deletes: Set<string>;
  timer: ReturnType<typeof setTimeout> | null;
}

const makePending = (
  overrides: Partial<PendingChanges> = {},
): PendingChanges => ({
  dirs: new Set(["/repo/src"]),
  files: new Set(["/repo/src/a.ts"]),
  deletes: new Set(["/repo/src/b.ts"]),
  timer: setTimeout(() => {}, 1_000_000),
  ...overrides,
});

describe("FileWatcherService.flushPending", () => {
  let registry: { isShutdown: boolean };
  let service: FileWatcherService;

  beforeEach(() => {
    registry = { isShutdown: false };
    service = new FileWatcherService(
      registry as unknown as WatcherRegistryService,
    );
  });

  it("does not emit events when the watcher registry is shut down", () => {
    registry.isShutdown = true;
    const emitSpy = vi.spyOn(service, "emit");
    const pending = makePending();

    (
      service as unknown as {
        flushPending: (repoPath: string, pending: PendingChanges) => void;
      }
    ).flushPending("/repo", pending);

    expect(emitSpy).not.toHaveBeenCalled();
    expect(pending.dirs.size).toBe(0);
    expect(pending.files.size).toBe(0);
    expect(pending.deletes.size).toBe(0);
    expect(pending.timer).toBeNull();
  });

  it("emits per-path events when the registry is active", () => {
    const emitSpy = vi.spyOn(service, "emit");
    const pending = makePending();

    (
      service as unknown as {
        flushPending: (repoPath: string, pending: PendingChanges) => void;
      }
    ).flushPending("/repo", pending);

    expect(emitSpy).toHaveBeenCalledWith(FileWatcherEvent.DirectoryChanged, {
      repoPath: "/repo",
      dirPath: "/repo/src",
    });
    expect(emitSpy).toHaveBeenCalledWith(FileWatcherEvent.FileChanged, {
      repoPath: "/repo",
      filePath: "/repo/src/a.ts",
    });
    expect(emitSpy).toHaveBeenCalledWith(FileWatcherEvent.FileDeleted, {
      repoPath: "/repo",
      filePath: "/repo/src/b.ts",
    });
    expect(pending.timer).toBeNull();
  });
});
