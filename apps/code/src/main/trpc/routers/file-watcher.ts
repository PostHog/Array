import { container } from "../../di/container";
import { MAIN_TOKENS } from "../../di/tokens";
import {
  FileWatcherEvent,
  type FileWatcherEvents,
  listDirectoryInput,
  listDirectoryOutput,
  watcherInput,
} from "../../services/file-watcher/schemas";
import type { FileWatcherService } from "../../services/file-watcher/service";
import { publicProcedure, router } from "../trpc";

const getService = () =>
  container.get<FileWatcherService>(MAIN_TOKENS.FileWatcherService);

function subscribe<K extends keyof FileWatcherEvents>(event: K) {
  return publicProcedure.subscription(async function* (opts) {
    const service = getService();
    const iterable = service.toIterable(event, { signal: opts.signal });
    for await (const data of iterable) {
      yield data;
    }
  });
}

export const fileWatcherRouter = router({
  listDirectory: publicProcedure
    .input(listDirectoryInput)
    .output(listDirectoryOutput)
    .query(({ input }) => getService().listDirectory(input.dirPath)),

  start: publicProcedure
    .input(watcherInput)
    .mutation(({ input }) => getService().startWatching(input.repoPath)),

  stop: publicProcedure
    .input(watcherInput)
    .mutation(({ input }) => getService().stopWatching(input.repoPath)),

  onDirectoryChanged: subscribe(FileWatcherEvent.DirectoryChanged),
  onFileChanged: subscribe(FileWatcherEvent.FileChanged),
  onFileDeleted: subscribe(FileWatcherEvent.FileDeleted),
  onGitStateChanged: subscribe(FileWatcherEvent.GitStateChanged),
  onWorkingTreeChanged: subscribe(FileWatcherEvent.WorkingTreeChanged),
});
