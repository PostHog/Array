import { createStore } from "zustand/vanilla";
import type { NotebookListItem } from "./schemas";

// Domain facts about the project's notebooks list. State only — fetching,
// validation, and error mapping live in NotebooksService.
interface NotebooksState {
  notebooks: NotebookListItem[];
  notebooksLoading: boolean;
  notebooksError: string | null;
  setNotebooks: (notebooks: NotebookListItem[]) => void;
  setNotebooksLoading: (notebooksLoading: boolean) => void;
  setNotebooksError: (notebooksError: string | null) => void;
  upsertNotebook: (notebook: NotebookListItem) => void;
  removeNotebook: (shortId: string) => void;
}

export const notebooksStore = createStore<NotebooksState>((set) => ({
  notebooks: [],
  notebooksLoading: false,
  notebooksError: null,
  setNotebooks: (notebooks) => set({ notebooks }),
  setNotebooksLoading: (notebooksLoading) => set({ notebooksLoading }),
  setNotebooksError: (notebooksError) => set({ notebooksError }),
  upsertNotebook: (notebook) =>
    set((state) => {
      const exists = state.notebooks.some(
        (n) => n.short_id === notebook.short_id,
      );
      return {
        notebooks: exists
          ? state.notebooks.map((n) =>
              n.short_id === notebook.short_id ? notebook : n,
            )
          : [notebook, ...state.notebooks],
      };
    }),
  removeNotebook: (shortId) =>
    set((state) => ({
      notebooks: state.notebooks.filter((n) => n.short_id !== shortId),
    })),
}));
