import { container } from "../../di/container";
import { MAIN_TOKENS } from "../../di/tokens";
import {
  boundedReadResult,
  listRepoFilesInput,
  listRepoFilesOutput,
  readAbsoluteFileInput,
  readRepoFileBoundedInput,
  readRepoFileInput,
  readRepoFileOutput,
  readRepoFilesBoundedInput,
  readRepoFilesBoundedOutput,
  readRepoFilesInput,
  readRepoFilesOutput,
  writeRepoFileInput,
} from "../../services/fs/schemas";
import type { FsService } from "../../services/fs/service";
import { publicProcedure, router } from "../trpc";

const getService = () => container.get<FsService>(MAIN_TOKENS.FsService);

export const fsRouter = router({
  listRepoFiles: publicProcedure
    .input(listRepoFilesInput)
    .output(listRepoFilesOutput)
    .query(({ input }) =>
      getService().listRepoFiles(input.repoPath, input.query, input.limit),
    ),

  readRepoFile: publicProcedure
    .input(readRepoFileInput)
    .output(readRepoFileOutput)
    .query(({ input }) =>
      getService().readRepoFile(input.repoPath, input.filePath),
    ),

  readRepoFiles: publicProcedure
    .input(readRepoFilesInput)
    .output(readRepoFilesOutput)
    .query(({ input }) =>
      getService().readRepoFiles(input.repoPath, input.filePaths),
    ),

  readRepoFileBounded: publicProcedure
    .input(readRepoFileBoundedInput)
    .output(boundedReadResult)
    .query(({ input }) =>
      getService().readRepoFileBounded(
        input.repoPath,
        input.filePath,
        input.maxLines,
      ),
    ),

  readRepoFilesBounded: publicProcedure
    .input(readRepoFilesBoundedInput)
    .output(readRepoFilesBoundedOutput)
    .query(({ input }) =>
      getService().readRepoFilesBounded(
        input.repoPath,
        input.filePaths,
        input.maxLines,
      ),
    ),

  readAbsoluteFile: publicProcedure
    .input(readAbsoluteFileInput)
    .output(readRepoFileOutput)
    .query(({ input }) => getService().readAbsoluteFile(input.filePath)),

  readFileAsBase64: publicProcedure
    .input(readAbsoluteFileInput)
    .output(readRepoFileOutput)
    .query(({ input }) => getService().readFileAsBase64(input.filePath)),

  writeRepoFile: publicProcedure
    .input(writeRepoFileInput)
    .mutation(({ input }) =>
      getService().writeRepoFile(input.repoPath, input.filePath, input.content),
    ),
});
