import { vol } from "memfs";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return { ...fs.promises, default: fs.promises };
});

import {
  deriveWorktreePath,
  resolveWorktreePathByProbe,
} from "./worktree-path";

const BASE = "/worktrees";
const FOLDER = "/repos/my-repo";

afterEach(() => {
  vol.reset();
});

describe("deriveWorktreePath", () => {
  it("uses the new <base>/<name>/<repo> layout for numeric names", () => {
    expect(deriveWorktreePath(BASE, FOLDER, "123")).toBe(
      "/worktrees/123/my-repo",
    );
  });

  it("uses the legacy <base>/<repo>/<name> layout for non-numeric names", () => {
    expect(deriveWorktreePath(BASE, FOLDER, "feature-x")).toBe(
      "/worktrees/my-repo/feature-x",
    );
  });

  it("derives the repo name from the folder path basename", () => {
    expect(deriveWorktreePath(BASE, "/a/b/other-repo", "feat")).toBe(
      "/worktrees/other-repo/feat",
    );
  });

  it("treats a name with non-digit characters as legacy", () => {
    expect(deriveWorktreePath(BASE, FOLDER, "12a")).toBe(
      "/worktrees/my-repo/12a",
    );
  });
});

describe("resolveWorktreePathByProbe", () => {
  const NEW_PATH = "/worktrees/feat/my-repo";
  const LEGACY_PATH = "/worktrees/my-repo/feat";

  it("prefers the new-format path when it exists on disk", async () => {
    vol.mkdirSync(NEW_PATH, { recursive: true });

    expect(await resolveWorktreePathByProbe(BASE, FOLDER, "feat")).toBe(
      NEW_PATH,
    );
  });

  it("falls back to the legacy path when only it exists", async () => {
    vol.mkdirSync(LEGACY_PATH, { recursive: true });

    expect(await resolveWorktreePathByProbe(BASE, FOLDER, "feat")).toBe(
      LEGACY_PATH,
    );
  });

  it("prefers the new path when both layouts exist", async () => {
    vol.mkdirSync(NEW_PATH, { recursive: true });
    vol.mkdirSync(LEGACY_PATH, { recursive: true });

    expect(await resolveWorktreePathByProbe(BASE, FOLDER, "feat")).toBe(
      NEW_PATH,
    );
  });

  it("defaults to the new-format path when neither layout exists", async () => {
    expect(await resolveWorktreePathByProbe(BASE, FOLDER, "feat")).toBe(
      NEW_PATH,
    );
  });
});
