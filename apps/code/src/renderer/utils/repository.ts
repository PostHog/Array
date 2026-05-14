import { normalizeRepoKey } from "@shared/utils/repo";

export const parseRepository = (
  repository: string,
): { organization: string; repoName: string } | null => {
  const result = repository.split("/");

  if (result.length !== 2) {
    return null;
  }

  return { organization: result[0], repoName: result[1] };
};

export function getTaskRepository(task: {
  repository?: string | null;
}): string | null {
  return task.repository ?? null;
}

export function normalizeRepositoryLookupKey(repository: string): string {
  return normalizeRepoKey(repository).toLowerCase();
}

export function findMatchingRepository(
  repository: string | null | undefined,
  repositories: string[],
): string | null {
  if (!repository) return null;

  const normalizedRepository = normalizeRepositoryLookupKey(repository);
  return (
    repositories.find(
      (candidate) =>
        normalizeRepositoryLookupKey(candidate) === normalizedRepository,
    ) ?? null
  );
}
