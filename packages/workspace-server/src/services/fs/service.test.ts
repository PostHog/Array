import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@posthog/git/queries", () => ({
  getChangedFiles: vi.fn(async () => new Set<string>()),
  listAllFiles: vi.fn(async () => []),
}));

import { getChangedFiles, listAllFiles } from "@posthog/git/queries";
import { FsService } from "./service";

describe("FsService.listRepoFiles", () => {
  it("derives directory entries alongside files", async () => {
    vi.mocked(getChangedFiles).mockResolvedValue(new Set());
    vi.mocked(listAllFiles).mockResolvedValue([
      "a.ts",
      "src/b.ts",
      "src/sub/c.ts",
    ]);

    const service = new FsService();
    const entries = await service.listRepoFiles("/repo");

    const dirs = entries
      .filter((e) => e.kind === "directory")
      .map((e) => e.path);
    const files = entries.filter((e) => e.kind === "file").map((e) => e.path);

    expect(dirs).toEqual(["src", "src/sub"]);
    expect(files).toEqual(["a.ts", "src/b.ts", "src/sub/c.ts"]);
  });

  it("filters directories and files by query substring", async () => {
    vi.mocked(getChangedFiles).mockResolvedValue(new Set());
    vi.mocked(listAllFiles).mockResolvedValue([
      "a.ts",
      "src/b.ts",
      "src/sub/c.ts",
    ]);

    const service = new FsService();
    const entries = await service.listRepoFiles("/repo", "sub");

    expect(entries.map((e) => ({ path: e.path, kind: e.kind }))).toEqual([
      { path: "src/sub", kind: "directory" },
      { path: "src/sub/c.ts", kind: "file" },
    ]);
  });
});

describe("FsService repo file IO", () => {
  let repo: string;
  const service = new FsService();

  beforeEach(async () => {
    repo = await mkdtemp(path.join(tmpdir(), "fs-service-test-"));
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it("writes a repo file and reads it back", async () => {
    await service.writeRepoFile(repo, "file.txt", "hello");

    expect(await service.readRepoFile(repo, "file.txt")).toBe("hello");
    expect(await readFile(path.join(repo, "file.txt"), "utf-8")).toBe("hello");
  });

  it("returns null reading a missing file", async () => {
    expect(await service.readRepoFile(repo, "nope.txt")).toBeNull();
  });

  it("refuses to read outside the repository", async () => {
    await expect(
      service.readRepoFile(repo, "../escape.txt"),
    ).resolves.toBeNull();
    await expect(
      service.writeRepoFile(repo, "../escape.txt", "x"),
    ).rejects.toThrow(/Access denied/);
  });

  it("bounds reads by line count", async () => {
    await service.writeRepoFile(repo, "small.txt", "a\nb\nc");
    await service.writeRepoFile(repo, "big.txt", "a\nb\nc\nd\ne");

    expect(await service.readRepoFileBounded(repo, "small.txt", 5)).toEqual({
      kind: "content",
      content: "a\nb\nc",
    });
    expect(await service.readRepoFileBounded(repo, "big.txt", 3)).toEqual({
      kind: "too-large",
    });
    expect(await service.readRepoFileBounded(repo, "missing.txt", 3)).toEqual({
      kind: "missing",
    });
  });
});
