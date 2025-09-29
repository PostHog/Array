// Stub GitHub service for future use
// In the future we can add: listBranches, createBranch, createPR, getRepoInfo, etc.

export async function listBranches(): Promise<string[]> {
  return [];
}

export async function createPullRequest(): Promise<{ url: string }> {
  return { url: '' };
}