import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockReadFile = vi.hoisted(() => vi.fn());
const mockStat = vi.hoisted(() => vi.fn());

vi.mock("node:fs", () => {
  const promises = {
    readFile: mockReadFile,
    stat: mockStat,
    access: vi.fn(),
    writeFile: vi.fn(),
    unlink: vi.fn(),
    readdir: vi.fn(),
    mkdir: vi.fn(),
    mkdtemp: vi.fn(),
  };
  const constants = { W_OK: 2 };
  return { promises, constants, default: { promises, constants } };
});

import { OsService } from "./os";

function createService() {
  const dialog = {
    pickFile: vi.fn(),
    confirm: vi.fn(),
  };
  const urlLauncher = { launch: vi.fn().mockResolvedValue(undefined) };
  const appMeta = { version: "9.9.9" };
  const imageProcessor = { downscale: vi.fn() };
  const workspaceSettings = {
    getWorktreeLocation: vi.fn(() => "/tmp/worktrees"),
  };

  const storagePaths = {
    appDataPath: "/data",
    logsPath: "/logs",
    logFolderPath: "/logs",
  };

  const service = new OsService(
    dialog as never,
    urlLauncher as never,
    appMeta as never,
    imageProcessor as never,
    workspaceSettings as never,
    storagePaths as never,
  );

  return { service, dialog, urlLauncher, appMeta, workspaceSettings };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("OsService.showMessageBox", () => {
  it("maps options onto dialog.confirm and returns the chosen response", async () => {
    const { service, dialog } = createService();
    dialog.confirm.mockResolvedValue(1);

    const result = await service.showMessageBox({
      type: "warning",
      title: "Heads up",
      message: "Are you sure?",
      buttons: ["Cancel", "Proceed"],
      defaultId: 1,
      cancelId: 0,
    });

    expect(result).toEqual({ response: 1 });
    expect(dialog.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: "warning",
        title: "Heads up",
        message: "Are you sure?",
        options: ["Cancel", "Proceed"],
        defaultIndex: 1,
        cancelIndex: 0,
      }),
    );
  });

  it("treats a 'none' type as no severity", async () => {
    const { service, dialog } = createService();
    dialog.confirm.mockResolvedValue(0);

    await service.showMessageBox({ type: "none", message: "hi" });

    expect(dialog.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ severity: undefined }),
    );
  });

  it("falls back to a default title and an OK button", async () => {
    const { service, dialog } = createService();
    dialog.confirm.mockResolvedValue(0);

    await service.showMessageBox({ message: "" });

    expect(dialog.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: "PostHog Code", options: ["OK"] }),
    );
  });
});

describe("OsService directory and file pickers", () => {
  it("returns the first picked path for selectDirectory", async () => {
    const { service, dialog } = createService();
    dialog.pickFile.mockResolvedValue(["/repo/one", "/repo/two"]);
    expect(await service.selectDirectory()).toBe("/repo/one");
  });

  it("returns null from selectDirectory when nothing is picked", async () => {
    const { service, dialog } = createService();
    dialog.pickFile.mockResolvedValue([]);
    expect(await service.selectDirectory()).toBeNull();
  });

  it("passes through the picked files for selectFiles", async () => {
    const { service, dialog } = createService();
    dialog.pickFile.mockResolvedValue(["/a.txt", "/b.txt"]);
    expect(await service.selectFiles()).toEqual(["/a.txt", "/b.txt"]);
  });

  it("classifies selected attachments by stat kind and drops unreadable ones", async () => {
    const { service, dialog } = createService();
    dialog.pickFile.mockResolvedValue(["/dir", "/file", "/gone"]);
    mockStat.mockImplementation(async (p: string) => {
      if (p === "/gone") throw new Error("ENOENT");
      return { isDirectory: () => p === "/dir" };
    });

    const result = await service.selectAttachments("both");

    expect(result).toEqual([
      { path: "/dir", kind: "directory" },
      { path: "/file", kind: "file" },
    ]);
    expect(dialog.pickFile).toHaveBeenCalledWith(
      expect.objectContaining({ filesAndDirectories: true, multiple: true }),
    );
  });
});

describe("OsService simple delegations", () => {
  it("returns the app version from app meta", () => {
    const { service } = createService();
    expect(service.getAppVersion()).toBe("9.9.9");
  });

  it("returns the worktree location from workspace settings", () => {
    const { service } = createService();
    expect(service.getWorktreeLocation()).toBe("/tmp/worktrees");
  });

  it("opens external URLs through the url launcher", async () => {
    const { service, urlLauncher } = createService();
    await service.openExternal("https://posthog.com");
    expect(urlLauncher.launch).toHaveBeenCalledWith("https://posthog.com");
  });

  it("opens the log folder as a file URL via the url launcher", async () => {
    const { service, urlLauncher } = createService();
    await service.showLogFolder();
    expect(urlLauncher.launch).toHaveBeenCalledWith(
      expect.stringMatching(/^file:\/\//),
    );
  });
});

describe("OsService.getUserAgentInstructions", () => {
  const home = os.homedir();
  const agentsPath = path.join(home, ".agents", "AGENTS.md");
  const codexPath = path.join(home, ".codex", "AGENTS.md");
  const claudePath = path.join(home, ".claude", "CLAUDE.md");

  function givenFiles(files: Record<string, string>) {
    mockReadFile.mockImplementation(async (filePath: string) => {
      if (filePath in files) return files[filePath];
      throw new Error("ENOENT");
    });
  }

  it.each([
    {
      label: "prefers an AGENTS.md over the user CLAUDE.md",
      files: {
        [codexPath]: "codex instructions",
        [claudePath]: "claude instructions",
      },
      winner: {
        path: codexPath,
        displayPath: "~/.codex/AGENTS.md",
        content: "codex instructions",
      },
    },
    {
      label: "prefers ~/.agents/AGENTS.md over ~/.codex/AGENTS.md",
      files: {
        [agentsPath]: "agents instructions",
        [codexPath]: "codex instructions",
      },
      winner: {
        path: agentsPath,
        displayPath: "~/.agents/AGENTS.md",
        content: "agents instructions",
      },
    },
    {
      label: "falls back to the user CLAUDE.md when no AGENTS.md exists",
      files: { [claudePath]: "claude instructions" },
      winner: {
        path: claudePath,
        displayPath: "~/.claude/CLAUDE.md",
        content: "claude instructions",
      },
    },
  ])("$label", async ({ files, winner }) => {
    const { service } = createService();
    givenFiles(files);

    expect(await service.getUserAgentInstructions()).toEqual({
      ...winner,
      truncated: false,
    });
  });

  it("skips whitespace-only files", async () => {
    const { service } = createService();
    givenFiles({ [agentsPath]: "  \n\t", [claudePath]: "real instructions" });

    const result = await service.getUserAgentInstructions();
    expect(result?.path).toBe(claudePath);
  });

  it("returns null when no candidate file exists", async () => {
    const { service } = createService();
    givenFiles({});

    expect(await service.getUserAgentInstructions()).toBeNull();
  });

  it("truncates oversized files and flags the truncation", async () => {
    const { service } = createService();
    givenFiles({ [claudePath]: "x".repeat(25_000) });

    const result = await service.getUserAgentInstructions();
    expect(result?.content).toHaveLength(20_000);
    expect(result?.truncated).toBe(true);
  });
});

describe("OsService.getClaudePermissions", () => {
  it("returns the allow and deny arrays from the settings file", async () => {
    const { service } = createService();
    mockReadFile.mockResolvedValue(
      JSON.stringify({ permissions: { allow: ["Read"], deny: ["Bash"] } }),
    );

    expect(await service.getClaudePermissions()).toEqual({
      allow: ["Read"],
      deny: ["Bash"],
    });
  });

  it("returns empty arrays when the settings file is missing", async () => {
    const { service } = createService();
    mockReadFile.mockRejectedValue(new Error("ENOENT"));

    expect(await service.getClaudePermissions()).toEqual({
      allow: [],
      deny: [],
    });
  });

  it("returns empty arrays when permissions are malformed", async () => {
    const { service } = createService();
    mockReadFile.mockResolvedValue(
      JSON.stringify({ permissions: { allow: "not-an-array" } }),
    );

    expect(await service.getClaudePermissions()).toEqual({
      allow: [],
      deny: [],
    });
  });
});
