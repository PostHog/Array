import { z } from "zod";

export const listDirectoryInput = z.object({
  dirPath: z.string(),
});

export const watcherInput = z.object({
  repoPath: z.string(),
});

const directoryEntry = z.object({
  name: z.string(),
  path: z.string(),
  type: z.enum(["file", "directory"]),
});

export const listDirectoryOutput = z.array(directoryEntry);

export type ListDirectoryInput = z.infer<typeof listDirectoryInput>;
export type WatcherInput = z.infer<typeof watcherInput>;
export type DirectoryEntry = z.infer<typeof directoryEntry>;

export const FileWatcherEvent = {
  DirectoryChanged: "directory-changed",
  FileChanged: "file-changed",
  FileDeleted: "file-deleted",
  GitStateChanged: "git-state-changed",
  WorkingTreeChanged: "working-tree-changed",
} as const;

export type DirectoryChangedPayload = {
  repoPath: string;
  dirPath: string;
};

export type FileChangedPayload = {
  repoPath: string;
  filePath: string;
};

export type FileDeletedPayload = {
  repoPath: string;
  filePath: string;
};

export type GitStateChangedPayload = {
  repoPath: string;
};

export type WorkingTreeChangedPayload = {
  repoPath: string;
};

export interface FileWatcherEvents {
  [FileWatcherEvent.DirectoryChanged]: DirectoryChangedPayload;
  [FileWatcherEvent.FileChanged]: FileChangedPayload;
  [FileWatcherEvent.FileDeleted]: FileDeletedPayload;
  [FileWatcherEvent.GitStateChanged]: GitStateChangedPayload;
  [FileWatcherEvent.WorkingTreeChanged]: WorkingTreeChangedPayload;
}
