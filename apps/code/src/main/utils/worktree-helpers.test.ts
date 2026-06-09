import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let testWorktreeBasePath = "/tmp/worktrees";
vi.mock("../services/settingsStore", () => ({
  getWorktreeLocation: () => testWorktreeBasePath,
}));

import { deriveWorktreePath } from "./worktree-helpers";

const REPO = "/repos/posthog";
const REPO_NAME = "posthog";
const NAME = "plucky-summit-59";

describe("deriveWorktreePath", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "wt-helpers-"));
    testWorktreeBasePath = tmpDir;
  });

  afterEach(async () => {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  it("returns the new layout (<base>/<name>/<repo>) when it exists on disk", async () => {
    const newPath = path.join(tmpDir, NAME, REPO_NAME);
    await fsp.mkdir(newPath, { recursive: true });

    expect(deriveWorktreePath(REPO, NAME)).toBe(newPath);
  });

  it("falls back to the legacy layout (<base>/<repo>/<name>) when only it exists", async () => {
    const legacyPath = path.join(tmpDir, REPO_NAME, NAME);
    await fsp.mkdir(legacyPath, { recursive: true });

    expect(deriveWorktreePath(REPO, NAME)).toBe(legacyPath);
  });

  it("defaults to the new layout when neither exists (creation case)", () => {
    expect(deriveWorktreePath(REPO, NAME)).toBe(
      path.join(tmpDir, NAME, REPO_NAME),
    );
  });
});
