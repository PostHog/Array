import { useAuthStore } from "@features/auth/stores/authStore";
import type { RepositoryConfig } from "@shared/types";
import { cloneStore } from "@stores/cloneStore";
import { expandTildePath } from "@utils/path";
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface RepositoryWorkspaceState {
  selectedRepository: RepositoryConfig | null;
  derivedPath: string;
  pathExists: boolean;
  isValidating: boolean;

  selectRepository: (repo: RepositoryConfig) => Promise<void>;
  clearRepository: () => void;
  validateAndUpdatePath: () => Promise<void>;
}

interface ValidationResult {
  valid: boolean;
  exists: boolean;
  detected?: RepositoryConfig;
}

const POLL_INTERVAL_MS = 1000;

const getRepoKey = (repo: RepositoryConfig) =>
  `${repo.organization}/${repo.repository}`;

const getDerivedPath = (repo: RepositoryConfig): string | null => {
  const { defaultWorkspace } = useAuthStore.getState();
  if (!defaultWorkspace) return null;
  return `${expandTildePath(defaultWorkspace)}/${repo.repository}`;
};

const validateRepository = async (
  path: string,
  repo: RepositoryConfig,
): Promise<ValidationResult> => {
  const [exists, validation] = await Promise.all([
    window.electronAPI.validateRepo(path),
    window.electronAPI.validateRepositoryMatch(
      path,
      repo.organization,
      repo.repository,
    ),
  ]);

  return {
    valid: exists && validation.valid,
    exists,
    detected: validation.detected || undefined,
  };
};

const showError = async (title: string, message: string, detail?: string) => {
  await window.electronAPI.showMessageBox({
    type: "error",
    title,
    message,
    detail,
    buttons: ["OK"],
  });
};

export const repositoryWorkspaceStore = create<RepositoryWorkspaceState>()(
  persist(
    (set, get) => {
      let pollingInterval: number | null = null;

      const stopPolling = () => {
        if (pollingInterval) {
          clearInterval(pollingInterval);
          pollingInterval = null;
        }
      };

      const startPolling = () => {
        stopPolling();

        pollingInterval = window.setInterval(async () => {
          const { selectedRepository, derivedPath, pathExists } = get();

          if (!selectedRepository || !derivedPath) {
            stopPolling();
            return;
          }

          const exists = await window.electronAPI
            .validateRepo(derivedPath)
            .catch(() => false);

          if (exists && !pathExists) {
            set({ pathExists: true });
            stopPolling();
            return;
          }

          const { operations } = cloneStore.getState();
          const hasActiveClone = Object.values(operations).some(
            (op) =>
              getRepoKey(op.repository) === getRepoKey(selectedRepository),
          );

          if (!hasActiveClone && pathExists) stopPolling();
        }, POLL_INTERVAL_MS);
      };

      const initiateClone = async (
        repo: RepositoryConfig,
        targetPath: string,
      ) => {
        const sshCheck = await window.electronAPI.checkSSHAccess();

        if (!sshCheck.available) {
          await showError(
            "SSH not configured",
            "Cannot clone repository",
            sshCheck.error || "SSH access to GitHub is not available",
          );
          return;
        }

        const repoUrl = `git@github.com:${getRepoKey(repo)}.git`;
        const { cloneId } = await window.electronAPI.cloneRepository(
          repoUrl,
          targetPath,
        );
        cloneStore.getState().startClone(cloneId, repo, targetPath);
      };

      const handleMismatch = async (
        repo: RepositoryConfig,
        detected: RepositoryConfig,
      ): Promise<boolean> => {
        const result = await window.electronAPI.showMessageBox({
          type: "error",
          title: "Repository mismatch",
          message: `Folder '${repo.repository}' exists but contains a different repository`,
          detail: `Expected: ${getRepoKey(repo)}\nFound: ${getRepoKey(detected)}`,
          buttons: ["Cancel", "Delete and clone"],
          defaultId: 0,
          cancelId: 0,
        });

        return result.response === 1;
      };

      return {
        selectedRepository: null,
        derivedPath: "",
        pathExists: false,
        isValidating: false,

        clearRepository: () => {
          stopPolling();
          set({
            selectedRepository: null,
            derivedPath: "",
            pathExists: false,
          });
        },

        validateAndUpdatePath: async () => {
          const { selectedRepository } = get();
          const targetPath =
            selectedRepository && getDerivedPath(selectedRepository);

          if (!targetPath) {
            set({ derivedPath: "", pathExists: false });
            return;
          }

          set({ derivedPath: targetPath, isValidating: true });

          try {
            const validation = await validateRepository(
              targetPath,
              selectedRepository,
            );
            set({ pathExists: validation.valid, isValidating: false });
          } catch (error) {
            console.error("Failed to validate path:", error);
            set({ pathExists: false, isValidating: false });
          }
        },

        selectRepository: async (repo: RepositoryConfig) => {
          const targetPath = getDerivedPath(repo);

          if (!targetPath) {
            await showError(
              "Workspace not configured",
              "Please configure a default workspace in settings",
            );
            return;
          }

          const validation = await validateRepository(targetPath, repo);

          if (validation.valid) {
            set({
              selectedRepository: repo,
              derivedPath: targetPath,
              pathExists: true,
            });
            return;
          }

          if (validation.exists && validation.detected) {
            const shouldClone = await handleMismatch(repo, validation.detected);
            if (!shouldClone) return;
          }

          set({
            selectedRepository: repo,
            derivedPath: targetPath,
            pathExists: false,
          });

          await initiateClone(repo, targetPath);
          startPolling();
        },
      };
    },
    {
      name: "repository-workspace",
      partialize: (state) => ({
        selectedRepository: state.selectedRepository,
      }),
    },
  ),
);
