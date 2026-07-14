import { createContext, type ReactNode, useContext } from "react";

export interface NotebookCellContextValue {
  /** The notebook's short id — the key for all kernel/SQL cell API calls. */
  shortId: string;
}

const NotebookCellContext = createContext<NotebookCellContextValue | null>(
  null,
);

/**
 * Provides the notebook identity to runnable cells (Python/SQL). The notebook
 * view mounts this around the markdown editor; cells render a hint when it is
 * absent (e.g. a registry preview outside a notebook).
 */
export function NotebookCellContextProvider({
  shortId,
  children,
}: {
  shortId: string;
  children: ReactNode;
}) {
  return (
    <NotebookCellContext.Provider value={{ shortId }}>
      {children}
    </NotebookCellContext.Provider>
  );
}

export function useNotebookCellContext(): NotebookCellContextValue | null {
  return useContext(NotebookCellContext);
}
