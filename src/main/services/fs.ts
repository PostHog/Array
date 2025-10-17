import { exec } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { type IpcMainInvokeEvent, ipcMain } from "electron";

const execAsync = promisify(exec);
const fsPromises = fs.promises;

interface FileEntry {
  path: string;
  name: string;
}

// Cache for repository files to avoid rescanning
const repoFileCache = new Map<
  string,
  { files: FileEntry[]; timestamp: number }
>();
const CACHE_TTL = 30000; // 30 seconds

async function getGitIgnoredFiles(repoPath: string): Promise<Set<string>> {
  try {
    const { stdout } = await execAsync(
      "git ls-files --others --ignored --exclude-standard",
      { cwd: repoPath },
    );
    return new Set(
      stdout
        .split("\n")
        .filter(Boolean)
        .map((f) => path.join(repoPath, f)),
    );
  } catch {
    // If git command fails, return empty set
    return new Set();
  }
}

async function listFilesRecursive(
  dirPath: string,
  ignoredFiles: Set<string>,
  baseDir: string,
): Promise<FileEntry[]> {
  const files: FileEntry[] = [];

  try {
    const entries = await fsPromises.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      const relativePath = path.relative(baseDir, fullPath);

      // Skip hidden files/directories, node_modules, and common build dirs
      if (
        entry.name.startsWith(".") ||
        entry.name === "node_modules" ||
        entry.name === "dist" ||
        entry.name === "build" ||
        entry.name === "__pycache__"
      ) {
        continue;
      }

      // Skip git-ignored files
      if (ignoredFiles.has(fullPath)) {
        continue;
      }

      if (entry.isDirectory()) {
        const subFiles = await listFilesRecursive(
          fullPath,
          ignoredFiles,
          baseDir,
        );
        files.push(...subFiles);
      } else if (entry.isFile()) {
        files.push({
          path: relativePath,
          name: entry.name,
        });
      }
    }
  } catch (error) {
    // Skip directories we can't read
    console.error(`Error reading directory ${dirPath}:`, error);
  }

  return files;
}

export function registerFsIpc(): void {
  ipcMain.handle(
    "list-repo-files",
    async (
      _event: IpcMainInvokeEvent,
      repoPath: string,
      query?: string,
    ): Promise<FileEntry[]> => {
      if (!repoPath) return [];

      try {
        // Check cache
        const cached = repoFileCache.get(repoPath);
        const now = Date.now();

        let allFiles: FileEntry[];

        if (cached && now - cached.timestamp < CACHE_TTL) {
          allFiles = cached.files;
        } else {
          // Get git-ignored files
          const ignoredFiles = await getGitIgnoredFiles(repoPath);

          // List all files
          allFiles = await listFilesRecursive(repoPath, ignoredFiles, repoPath);

          // Update cache
          repoFileCache.set(repoPath, {
            files: allFiles,
            timestamp: now,
          });
        }

        // Filter by query if provided
        if (query?.trim()) {
          const lowerQuery = query.toLowerCase();
          return allFiles
            .filter(
              (f) =>
                f.path.toLowerCase().includes(lowerQuery) ||
                f.name.toLowerCase().includes(lowerQuery),
            )
            .slice(0, 50); // Limit results
        }

        return allFiles.slice(0, 100); // Limit initial results
      } catch (error) {
        console.error("Error listing repo files:", error);
        return [];
      }
    },
  );

  // Plan file operations
  ipcMain.handle(
    "ensure-posthog-folder",
    async (
      _event: IpcMainInvokeEvent,
      repoPath: string,
      taskId: string,
    ): Promise<string> => {
      const posthogDir = path.join(repoPath, ".posthog", taskId);
      await fsPromises.mkdir(posthogDir, { recursive: true });
      return posthogDir;
    },
  );

  ipcMain.handle(
    "read-plan-file",
    async (
      _event: IpcMainInvokeEvent,
      repoPath: string,
      taskId: string,
    ): Promise<string | null> => {
      try {
        const planPath = path.join(repoPath, ".posthog", taskId, "plan.md");
        const content = await fsPromises.readFile(planPath, "utf-8");
        return content;
      } catch (error) {
        // File doesn't exist or can't be read
        console.log(`Plan file not found for task ${taskId}:`, error);
        return null;
      }
    },
  );

  ipcMain.handle(
    "write-plan-file",
    async (
      _event: IpcMainInvokeEvent,
      repoPath: string,
      taskId: string,
      content: string,
    ): Promise<void> => {
      try {
        const posthogDir = path.join(repoPath, ".posthog", taskId);
        await fsPromises.mkdir(posthogDir, { recursive: true });
        const planPath = path.join(posthogDir, "plan.md");
        await fsPromises.writeFile(planPath, content, "utf-8");
        console.log(`Plan file written for task ${taskId}`);
      } catch (error) {
        console.error(`Failed to write plan file for task ${taskId}:`, error);
        throw error;
      }
    },
  );

  ipcMain.handle(
    "list-task-artifacts",
    async (
      _event: IpcMainInvokeEvent,
      repoPath: string,
      taskId: string,
    ): Promise<
      Array<{ name: string; path: string; size: number; modifiedAt: string }>
    > => {
      try {
        const posthogDir = path.join(repoPath, ".posthog", taskId);

        // Check if directory exists
        try {
          await fsPromises.access(posthogDir);
        } catch {
          return []; // Directory doesn't exist yet
        }

        const entries = await fsPromises.readdir(posthogDir, {
          withFileTypes: true,
        });

        const artifacts = [];
        for (const entry of entries) {
          if (entry.isFile() && entry.name.endsWith(".md")) {
            const filePath = path.join(posthogDir, entry.name);
            const stats = await fsPromises.stat(filePath);
            artifacts.push({
              name: entry.name,
              path: filePath,
              size: stats.size,
              modifiedAt: stats.mtime.toISOString(),
            });
          }
        }

        return artifacts;
      } catch (error) {
        console.error(`Failed to list artifacts for task ${taskId}:`, error);
        return [];
      }
    },
  );

  ipcMain.handle(
    "read-task-artifact",
    async (
      _event: IpcMainInvokeEvent,
      repoPath: string,
      taskId: string,
      fileName: string,
    ): Promise<string | null> => {
      try {
        const filePath = path.join(repoPath, ".posthog", taskId, fileName);
        const content = await fsPromises.readFile(filePath, "utf-8");
        return content;
      } catch (error) {
        console.error(
          `Failed to read artifact ${fileName} for task ${taskId}:`,
          error,
        );
        return null;
      }
    },
  );
}
