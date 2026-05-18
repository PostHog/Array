import { container } from "../../di/container";
import { MAIN_TOKENS } from "../../di/tokens";
import {
  archivedTaskContextMenuInput,
  archivedTaskContextMenuOutput,
  bulkTaskContextMenuInput,
  bulkTaskContextMenuOutput,
  confirmDeleteArchivedTaskInput,
  confirmDeleteArchivedTaskOutput,
  confirmDeleteTaskInput,
  confirmDeleteTaskOutput,
  confirmDeleteWorktreeInput,
  confirmDeleteWorktreeOutput,
  fileContextMenuInput,
  fileContextMenuOutput,
  folderContextMenuInput,
  folderContextMenuOutput,
  splitContextMenuOutput,
  tabContextMenuInput,
  tabContextMenuOutput,
  taskContextMenuInput,
  taskContextMenuOutput,
} from "../../services/context-menu/schemas";
import type { ContextMenuService } from "../../services/context-menu/service";
import { publicProcedure, router } from "../trpc";

const getService = () =>
  container.get<ContextMenuService>(MAIN_TOKENS.ContextMenuService);

export const contextMenuRouter = router({
  confirmDeleteTask: publicProcedure
    .input(confirmDeleteTaskInput)
    .output(confirmDeleteTaskOutput)
    .mutation(({ input }) => getService().confirmDeleteTask(input)),

  confirmDeleteArchivedTask: publicProcedure
    .input(confirmDeleteArchivedTaskInput)
    .output(confirmDeleteArchivedTaskOutput)
    .mutation(({ input }) => getService().confirmDeleteArchivedTask(input)),

  confirmDeleteWorktree: publicProcedure
    .input(confirmDeleteWorktreeInput)
    .output(confirmDeleteWorktreeOutput)
    .mutation(({ input }) => getService().confirmDeleteWorktree(input)),

  showTaskContextMenu: publicProcedure
    .input(taskContextMenuInput)
    .output(taskContextMenuOutput)
    .mutation(({ input }) => getService().showTaskContextMenu(input)),

  showBulkTaskContextMenu: publicProcedure
    .input(bulkTaskContextMenuInput)
    .output(bulkTaskContextMenuOutput)
    .mutation(({ input }) => getService().showBulkTaskContextMenu(input)),

  showArchivedTaskContextMenu: publicProcedure
    .input(archivedTaskContextMenuInput)
    .output(archivedTaskContextMenuOutput)
    .mutation(({ input }) => getService().showArchivedTaskContextMenu(input)),

  showFolderContextMenu: publicProcedure
    .input(folderContextMenuInput)
    .output(folderContextMenuOutput)
    .mutation(({ input }) => getService().showFolderContextMenu(input)),

  showTabContextMenu: publicProcedure
    .input(tabContextMenuInput)
    .output(tabContextMenuOutput)
    .mutation(({ input }) => getService().showTabContextMenu(input)),

  showSplitContextMenu: publicProcedure
    .output(splitContextMenuOutput)
    .mutation(() => getService().showSplitContextMenu()),

  showFileContextMenu: publicProcedure
    .input(fileContextMenuInput)
    .output(fileContextMenuOutput)
    .mutation(({ input }) => getService().showFileContextMenu(input)),
});
