import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockExistsSync = vi.hoisted(() => vi.fn());
const mockGetWorktreeLocation = vi.hoisted(() => vi.fn());

vi.mock("node:fs", () => ({
  existsSync: mockExistsSync,
  default: { existsSync: mockExistsSync },
}));

vi.mock("../services/settingsStore", () => ({
  getWorktreeLocation: mockGetWorktreeLocation,
}));

import { deriveWorktreePath } from "./worktree-helpers";

const WORKTREE_BASE = "/var/posthog/worktrees";
const FOLDER_PATH = "/home/user/projects/my-repo";
const REPO_NAME = "my-repo";

describe("deriveWorktreePath", () => {
  beforeEach(() => {
    mockGetWorktreeLocation.mockReturnValue(WORKTREE_BASE);
    mockExistsSync.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the modern path when only the modern worktree exists on disk", () => {
    const name = "brave-falcon";
    const modernPath = path.join(WORKTREE_BASE, name, REPO_NAME);
    const legacyPath = path.join(WORKTREE_BASE, REPO_NAME, name);
    mockExistsSync.mockImplementation((p) => p === modernPath);

    expect(deriveWorktreePath(FOLDER_PATH, name)).toBe(modernPath);
    expect(mockExistsSync).toHaveBeenCalledWith(modernPath);
    expect(mockExistsSync).not.toHaveBeenCalledWith(legacyPath);
  });

  it("returns the legacy path when only the legacy worktree exists on disk", () => {
    const name = "old-freeform-name";
    const modernPath = path.join(WORKTREE_BASE, name, REPO_NAME);
    const legacyPath = path.join(WORKTREE_BASE, REPO_NAME, name);
    mockExistsSync.mockImplementation((p) => p === legacyPath);

    expect(deriveWorktreePath(FOLDER_PATH, name)).toBe(legacyPath);
    expect(mockExistsSync).toHaveBeenCalledWith(modernPath);
    expect(mockExistsSync).toHaveBeenCalledWith(legacyPath);
  });

  it("prefers the modern path when both layouts exist on disk", () => {
    const name = "cosmic-river";
    const modernPath = path.join(WORKTREE_BASE, name, REPO_NAME);
    mockExistsSync.mockReturnValue(true);

    expect(deriveWorktreePath(FOLDER_PATH, name)).toBe(modernPath);
  });

  it("falls back to the modern path when neither layout exists yet", () => {
    const name = "witty-otter";
    const modernPath = path.join(WORKTREE_BASE, name, REPO_NAME);
    mockExistsSync.mockReturnValue(false);

    expect(deriveWorktreePath(FOLDER_PATH, name)).toBe(modernPath);
  });

  it("resolves numeric (pre-#1844) worktree names", () => {
    const name = "5142";
    const modernPath = path.join(WORKTREE_BASE, name, REPO_NAME);
    mockExistsSync.mockImplementation((p) => p === modernPath);

    expect(deriveWorktreePath(FOLDER_PATH, name)).toBe(modernPath);
  });

  it("resolves the adjective-noun + Date.now() fallback name", () => {
    const name = "brave-falcon1700000000000";
    const modernPath = path.join(WORKTREE_BASE, name, REPO_NAME);
    mockExistsSync.mockImplementation((p) => p === modernPath);

    expect(deriveWorktreePath(FOLDER_PATH, name)).toBe(modernPath);
  });

  it("returns a single path when the repo name equals the worktree name", () => {
    // Both layouts collapse to {base}/{name}/{name} when repoName === worktreeName,
    // so probe-both should stat the same path twice and return it regardless of
    // which existsSync call returns true.
    const name = REPO_NAME;
    const collapsedPath = path.join(WORKTREE_BASE, name, REPO_NAME);
    mockExistsSync.mockReturnValue(true);

    expect(deriveWorktreePath(FOLDER_PATH, name)).toBe(collapsedPath);
  });

  it("uses the current value of getWorktreeLocation (not a cached one)", () => {
    const name = "brave-falcon";
    mockExistsSync.mockReturnValue(false);

    mockGetWorktreeLocation.mockReturnValueOnce("/first/location");
    mockGetWorktreeLocation.mockReturnValueOnce("/second/location");

    expect(deriveWorktreePath(FOLDER_PATH, name)).toBe(
      path.join("/first/location", name, REPO_NAME),
    );
    expect(deriveWorktreePath(FOLDER_PATH, name)).toBe(
      path.join("/second/location", name, REPO_NAME),
    );
  });
});
