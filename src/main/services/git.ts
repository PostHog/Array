import { type ChildProcess, exec } from "node:child_process";
import fs from "node:fs";
import { promisify } from "node:util";
import { type BrowserWindow, type IpcMainInvokeEvent, ipcMain } from "electron";

const execAsync = promisify(exec);
const fsPromises = fs.promises;

const CLONE_MAX_BUFFER = 10 * 1024 * 1024;

export interface GitHubRepo {
  organization: string;
  repository: string;
}

interface CloneProgress {
  status: "cloning" | "complete" | "error";
  message: string;
}

interface ValidationResult {
  valid: boolean;
  detected?: GitHubRepo | null;
  error?: string;
}

const generateCloneId = () =>
  `clone-${Date.now()}-${Math.random().toString(36).substring(7)}`;

const sendCloneProgress = (
  win: BrowserWindow,
  cloneId: string,
  progress: CloneProgress,
) => {
  win.webContents.send(`clone-progress:${cloneId}`, progress);
};

export const parseGitHubUrl = (url: string): GitHubRepo | null => {
  const match =
    url.match(/github\.com[:/](.+?)\/(.+?)(\.git)?$/) ||
    url.match(/git@github\.com:(.+?)\/(.+?)(\.git)?$/);

  if (!match) return null;

  return {
    organization: match[1],
    repository: match[2].replace(/\.git$/, ""),
  };
};

export const isGitRepository = async (
  directoryPath: string,
): Promise<boolean> => {
  try {
    await execAsync("git rev-parse --is-inside-work-tree", {
      cwd: directoryPath,
    });
    return true;
  } catch {
    return false;
  }
};

export const getRemoteUrl = async (
  directoryPath: string,
): Promise<string | null> => {
  try {
    const { stdout } = await execAsync("git remote get-url origin", {
      cwd: directoryPath,
    });
    return stdout.trim();
  } catch {
    return null;
  }
};

const getCurrentBranch = async (
  directoryPath: string,
): Promise<string | undefined> => {
  try {
    const { stdout } = await execAsync("git branch --show-current", {
      cwd: directoryPath,
    });
    return stdout.trim();
  } catch {
    return undefined;
  }
};

export const detectSSHError = (output: string): string | undefined => {
  if (
    output.includes("successfully authenticated") ||
    output.includes("You've successfully authenticated")
  ) {
    return undefined;
  }

  if (output.includes("Permission denied")) {
    return "SSH keys not configured. Please add your SSH key to GitHub: https://github.com/settings/keys";
  }

  if (output.includes("Could not resolve hostname")) {
    return "Network error: Cannot reach github.com";
  }

  if (output.includes("Connection timed out")) {
    return "Connection timeout: Cannot reach github.com";
  }

  return `SSH test failed: ${output.substring(0, 200)}`;
};

export function registerGitIpc(
  getMainWindow: () => BrowserWindow | null,
): void {
  ipcMain.handle(
    "validate-repo",
    async (
      _event: IpcMainInvokeEvent,
      directoryPath: string,
    ): Promise<boolean> => {
      if (!directoryPath) return false;
      return isGitRepository(directoryPath);
    },
  );

  ipcMain.handle(
    "detect-repo",
    async (
      _event: IpcMainInvokeEvent,
      directoryPath: string,
    ): Promise<{
      organization: string;
      repository: string;
      branch?: string;
      remote?: string;
    } | null> => {
      if (!directoryPath) return null;

      const remoteUrl = await getRemoteUrl(directoryPath);
      if (!remoteUrl) return null;

      const repo = parseGitHubUrl(remoteUrl);
      if (!repo) return null;

      const branch = await getCurrentBranch(directoryPath);

      return { ...repo, branch, remote: remoteUrl };
    },
  );

  ipcMain.handle(
    "validate-repository-match",
    async (
      _event: IpcMainInvokeEvent,
      directoryPath: string,
      expectedOrg: string,
      expectedRepo: string,
    ): Promise<ValidationResult> => {
      if (!directoryPath) {
        return { valid: false, error: "No directory path provided" };
      }

      try {
        await fsPromises.access(directoryPath);
      } catch {
        return { valid: false, error: "Directory does not exist" };
      }

      if (!(await isGitRepository(directoryPath))) {
        return { valid: false, error: "Not a git repository" };
      }

      const remoteUrl = await getRemoteUrl(directoryPath);
      if (!remoteUrl) {
        return {
          valid: false,
          detected: null,
          error: "Could not detect GitHub repository",
        };
      }

      const detected = parseGitHubUrl(remoteUrl);
      if (!detected) {
        return {
          valid: false,
          detected: null,
          error: "Could not parse GitHub repository URL",
        };
      }

      const matches =
        detected.organization === expectedOrg &&
        detected.repository === expectedRepo;

      return {
        valid: matches,
        detected,
        error: matches
          ? undefined
          : `Folder contains ${detected.organization}/${detected.repository}, expected ${expectedOrg}/${expectedRepo}`,
      };
    },
  );

  ipcMain.handle(
    "check-ssh-access",
    async (): Promise<{ available: boolean; error?: string }> => {
      try {
        const { stdout, stderr } = await execAsync(
          'ssh -T git@github.com -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=5 2>&1 || echo "SSH_TEST_COMPLETE"',
        );

        const output = stdout + stderr;
        const error = detectSSHError(output);

        return error ? { available: false, error } : { available: true };
      } catch (error) {
        return {
          available: false,
          error: `Failed to test SSH: ${error instanceof Error ? error.message : "Unknown error"}`,
        };
      }
    },
  );

  const activeClones = new Map<string, boolean>();

  const setupCloneProcess = (
    cloneId: string,
    repoUrl: string,
    targetPath: string,
    win: BrowserWindow,
  ): ChildProcess => {
    const cloneProcess = exec(`git clone "${repoUrl}" "${targetPath}"`, {
      maxBuffer: CLONE_MAX_BUFFER,
    });

    sendCloneProgress(win, cloneId, {
      status: "cloning",
      message: `Cloning ${repoUrl}...`,
    });

    cloneProcess.stderr?.on("data", (data: Buffer) => {
      if (activeClones.get(cloneId)) {
        sendCloneProgress(win, cloneId, {
          status: "cloning",
          message: data.toString().trim(),
        });
      }
    });

    cloneProcess.on("close", (code: number) => {
      if (!activeClones.get(cloneId)) return;

      const status = code === 0 ? "complete" : "error";
      const message =
        code === 0
          ? "Repository cloned successfully"
          : `Clone failed with exit code ${code}`;

      sendCloneProgress(win, cloneId, { status, message });
      activeClones.delete(cloneId);
    });

    cloneProcess.on("error", (error: Error) => {
      if (activeClones.get(cloneId)) {
        sendCloneProgress(win, cloneId, {
          status: "error",
          message: `Clone error: ${error.message}`,
        });
        activeClones.delete(cloneId);
      }
    });

    return cloneProcess;
  };

  ipcMain.handle(
    "clone-repository",
    async (
      _event: IpcMainInvokeEvent,
      repoUrl: string,
      targetPath: string,
    ): Promise<{ cloneId: string }> => {
      const cloneId = generateCloneId();
      const win = getMainWindow();

      if (!win) throw new Error("Main window not available");

      activeClones.set(cloneId, true);
      setupCloneProcess(cloneId, repoUrl, targetPath, win);

      return { cloneId };
    },
  );
}
