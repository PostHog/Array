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

  it.each([
    {
      label: "new layout when it exists on disk",
      create: () => path.join(tmpDir, NAME, REPO_NAME),
      expected: () => path.join(tmpDir, NAME, REPO_NAME),
    },
    {
      label: "legacy layout when only it exists",
      create: () => path.join(tmpDir, REPO_NAME, NAME),
      expected: () => path.join(tmpDir, REPO_NAME, NAME),
    },
    {
      label: "new layout by default when neither exists (creation case)",
      create: () => null,
      expected: () => path.join(tmpDir, NAME, REPO_NAME),
    },
  ])("resolves the $label", async ({ create, expected }) => {
    const dir = create();
    if (dir) await fsp.mkdir(dir, { recursive: true });

    expect(deriveWorktreePath(REPO, NAME)).toBe(expected());
  });
});
