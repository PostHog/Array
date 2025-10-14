import { exec } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  type BrowserWindow,
  dialog,
  type IpcMainInvokeEvent,
  ipcMain,
  shell,
} from "electron";

const fsPromises = fs.promises;
const execAsync = promisify(exec);

interface MessageBoxOptionsCustom {
  type?: "info" | "error" | "warning" | "question";
  title?: string;
  message?: string;
  detail?: string;
  buttons?: string[];
  defaultId?: number;
  cancelId?: number;
}

export function registerOsIpc(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle("select-directory", async (): Promise<string | null> => {
    const win = getMainWindow();
    if (!win) return null;

    const result = await dialog.showOpenDialog(win, {
      title: "Select a repository folder",
      properties: [
        "openDirectory",
        "createDirectory",
        "treatPackageAsDirectory",
      ],
    });
    if (result.canceled || !result.filePaths?.length) {
      return null;
    }
    return result.filePaths[0];
  });

  ipcMain.handle(
    "validate-repo",
    async (
      _event: IpcMainInvokeEvent,
      directoryPath: string,
    ): Promise<boolean> => {
      if (!directoryPath) return false;
      try {
        await execAsync("git rev-parse --is-inside-work-tree", {
          cwd: directoryPath,
        });
        return true;
      } catch {
        return false;
      }
    },
  );

  ipcMain.handle(
    "check-write-access",
    async (
      _event: IpcMainInvokeEvent,
      directoryPath: string,
    ): Promise<boolean> => {
      if (!directoryPath) return false;
      try {
        await fsPromises.access(directoryPath, fs.constants.W_OK);
        const testFile = path.join(
          directoryPath,
          `.agent-write-test-${Date.now()}`,
        );
        await fsPromises.writeFile(testFile, "ok");
        await fsPromises.unlink(testFile).catch(() => {});
        return true;
      } catch {
        return false;
      }
    },
  );

  ipcMain.handle(
    "show-message-box",
    async (
      _event: IpcMainInvokeEvent,
      options: MessageBoxOptionsCustom,
    ): Promise<{ response: number }> => {
      const win = getMainWindow();
      if (!win) throw new Error("Main window not available");

      const result = await dialog.showMessageBox(win, {
        type: options?.type || "info",
        title: options?.title || "Array",
        message: options?.message || "",
        detail: options?.detail,
        buttons:
          Array.isArray(options?.buttons) && options.buttons.length > 0
            ? options.buttons
            : ["OK"],
        defaultId: options?.defaultId ?? 0,
        cancelId: options?.cancelId ?? 1,
      });
      return { response: result.response };
    },
  );

  ipcMain.handle(
    "open-external",
    async (_event: IpcMainInvokeEvent, url: string): Promise<void> => {
      await shell.openExternal(url);
    },
  );

  ipcMain.handle(
    "search-directories",
    async (_event: IpcMainInvokeEvent, query: string): Promise<string[]> => {
      if (!query?.trim()) {
        return [];
      }

      let searchPath = query.trim();
      if (searchPath.startsWith("~")) {
        searchPath = searchPath.replace(/^~/, os.homedir());
      }

      const lastSlashIdx = searchPath.lastIndexOf("/");
      const basePath =
        lastSlashIdx === -1 ? "" : searchPath.substring(0, lastSlashIdx + 1);
      const searchTerm =
        lastSlashIdx === -1
          ? searchPath
          : searchPath.substring(lastSlashIdx + 1);
      const pathToRead = basePath || os.homedir();

      try {
        const entries = await fsPromises.readdir(pathToRead, {
          withFileTypes: true,
        });
        let directories = entries.filter((entry) => entry.isDirectory());

        if (searchTerm) {
          const searchLower = searchTerm.toLowerCase();
          directories = directories.filter((dir) =>
            dir.name.toLowerCase().includes(searchLower),
          );
        }

        return directories
          .map((dir) => path.join(pathToRead, dir.name))
          .sort((a, b) => path.basename(a).localeCompare(path.basename(b)))
          .slice(0, 20);
      } catch {
        return [];
      }
    },
  );
}
