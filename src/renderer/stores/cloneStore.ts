import type { RepositoryConfig } from "@shared/types";
import { toast } from "@utils/toast";
import { create } from "zustand";

type CloneStatus = "cloning" | "complete" | "error";

interface CloneOperation {
  cloneId: string;
  repository: RepositoryConfig;
  targetPath: string;
  status: CloneStatus;
  messages: string[];
  error?: string;
  toastId?: string | number;
  unsubscribe?: () => void;
}

interface CloneStore {
  operations: Record<string, CloneOperation>;
  startClone: (
    cloneId: string,
    repository: RepositoryConfig,
    targetPath: string,
  ) => void;
  updateClone: (cloneId: string, status: CloneStatus, message: string) => void;
  removeClone: (cloneId: string) => void;
  isCloning: (repoKey: string) => boolean;
  getCloneForRepo: (repoKey: string) => CloneOperation | null;
}

const REMOVE_DELAY_SUCCESS_MS = 3000;
const REMOVE_DELAY_ERROR_MS = 5000;

const getRepoKey = (repo: RepositoryConfig) =>
  `${repo.organization}/${repo.repository}`;

export const cloneStore = create<CloneStore>((set, get) => {
  const handleComplete = (
    cloneId: string,
    repoKey: string,
    toastId: string | number,
  ) => {
    toast.success(`${repoKey} cloned successfully`, { id: toastId });
    window.setTimeout(
      () => get().removeClone(cloneId),
      REMOVE_DELAY_SUCCESS_MS,
    );
  };

  const handleError = (
    cloneId: string,
    repoKey: string,
    message: string,
    toastId: string | number,
  ) => {
    toast.error(`Failed to clone ${repoKey}`, {
      id: toastId,
      description: message,
    });
    window.setTimeout(() => get().removeClone(cloneId), REMOVE_DELAY_ERROR_MS);
  };

  return {
    operations: {},

    startClone: (cloneId, repository, targetPath) => {
      const repoKey = getRepoKey(repository);
      const toastId = toast.loading(`Cloning ${repoKey}`);

      const unsubscribe = window.electronAPI.onCloneProgress(
        cloneId,
        (event) => {
          get().updateClone(cloneId, event.status, event.message);

          const operation = get().operations[cloneId];
          if (!operation) return;

          if (event.status === "complete") {
            handleComplete(cloneId, repoKey, operation.toastId!);
          } else if (event.status === "error") {
            handleError(cloneId, repoKey, event.message, operation.toastId!);
          }
        },
      );

      set((state) => ({
        operations: {
          ...state.operations,
          [cloneId]: {
            cloneId,
            repository,
            targetPath,
            status: "cloning",
            messages: [],
            toastId,
            unsubscribe,
          },
        },
      }));
    },

    updateClone: (cloneId, status, message) => {
      set((state) => {
        const operation = state.operations[cloneId];
        if (!operation) return state;

        return {
          operations: {
            ...state.operations,
            [cloneId]: {
              ...operation,
              status,
              messages: [...operation.messages, message],
              error: status === "error" ? message : operation.error,
            },
          },
        };
      });
    },

    removeClone: (cloneId) => {
      set((state) => {
        const operation = state.operations[cloneId];
        operation?.unsubscribe?.();

        const { [cloneId]: _, ...remainingOps } = state.operations;
        return { operations: remainingOps };
      });
    },

    isCloning: (repoKey) =>
      Object.values(get().operations).some(
        (op) =>
          op.status === "cloning" && getRepoKey(op.repository) === repoKey,
      ),

    getCloneForRepo: (repoKey) =>
      Object.values(get().operations).find(
        (op) => getRepoKey(op.repository) === repoKey,
      ) ?? null,
  };
});
