import { afterEach, describe, expect, it, vi } from "vitest";
import { WorktreeManager } from "./worktree";
import { ADJECTIVES, NOUNS } from "./worktree-names";

type WithPrivate = {
  generateUniqueWorktreeName: () => Promise<string>;
};

const callGenerateUnique = (manager: WorktreeManager) =>
  (manager as unknown as WithPrivate).generateUniqueWorktreeName();

describe("WorktreeManager.generateWorktreeName", () => {
  it("returns a name in the adjective-noun format", () => {
    const manager = new WorktreeManager({ mainRepoPath: "/fake/repo" });
    const name = manager.generateWorktreeName();
    const [adjective, noun, ...rest] = name.split("-");
    expect(rest).toEqual([]);
    expect(ADJECTIVES).toContain(adjective);
    expect(NOUNS).toContain(noun);
  });
});

describe("WorktreeManager.generateUniqueWorktreeName", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the first generated name when there is no collision", async () => {
    const manager = new WorktreeManager({ mainRepoPath: "/fake/repo" });
    vi.spyOn(manager, "worktreeExists").mockResolvedValue(false);
    const generateSpy = vi
      .spyOn(manager, "generateWorktreeName")
      .mockReturnValueOnce("brave-falcon");

    const unique = await callGenerateUnique(manager);

    expect(unique).toBe("brave-falcon");
    expect(generateSpy).toHaveBeenCalledTimes(1);
  });

  it("retries when the first generated name already exists on disk", async () => {
    const manager = new WorktreeManager({ mainRepoPath: "/fake/repo" });
    vi.spyOn(manager, "worktreeExists")
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const generateSpy = vi
      .spyOn(manager, "generateWorktreeName")
      .mockReturnValueOnce("brave-falcon")
      .mockReturnValueOnce("calm-river");

    const unique = await callGenerateUnique(manager);

    expect(unique).toBe("calm-river");
    expect(generateSpy).toHaveBeenCalledTimes(2);
  });

  it("falls back to appending Date.now() after exhausting 100 retries", async () => {
    const manager = new WorktreeManager({ mainRepoPath: "/fake/repo" });
    vi.spyOn(manager, "worktreeExists").mockResolvedValue(true);
    const generateSpy = vi
      .spyOn(manager, "generateWorktreeName")
      .mockReturnValue("brave-falcon");
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);

    const unique = await callGenerateUnique(manager);

    expect(unique).toBe("brave-falcon1700000000000");
    // 1 initial draw + 100 in-loop retries + 1 fallback draw = 102.
    expect(generateSpy).toHaveBeenCalledTimes(102);
  });

  it("propagates errors from worktreeExists without masking them", async () => {
    const manager = new WorktreeManager({ mainRepoPath: "/fake/repo" });
    const boom = new Error("EACCES: permission denied");
    vi.spyOn(manager, "worktreeExists").mockRejectedValue(boom);
    vi.spyOn(manager, "generateWorktreeName").mockReturnValue("brave-falcon");

    await expect(callGenerateUnique(manager)).rejects.toThrow(
      "EACCES: permission denied",
    );
  });
});
