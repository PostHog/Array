import { createContext, type ReactNode, useContext } from "react";

const SessionTaskIdContext = createContext<string | null>(null);

export function SessionTaskIdProvider({
  taskId,
  children,
}: {
  taskId: string | null | undefined;
  children: ReactNode;
}) {
  return (
    <SessionTaskIdContext.Provider value={taskId ?? null}>
      {children}
    </SessionTaskIdContext.Provider>
  );
}

export function useSessionTaskId(): string | null {
  return useContext(SessionTaskIdContext);
}
