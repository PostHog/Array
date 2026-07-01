export function summarizeReposByOwner(
  repositories: readonly string[],
): { owner: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const repo of repositories) {
    const owner = repo.includes("/") ? (repo.split("/", 1)[0] ?? repo) : repo;
    counts.set(owner, (counts.get(owner) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([owner, count]) => ({ owner, count }))
    .sort((a, b) => b.count - a.count || a.owner.localeCompare(b.owner));
}

export interface GithubInstallationAccount {
  type?: string | null;
  name?: string | null;
}

export interface GithubInstallationLike {
  installation_id: string | number;
  account?: GithubInstallationAccount | null;
}

// GitHub's per-installation settings page for an org install is owner-only and
// 404s for members, so org installs point at the app page, which loads for
// anyone (owners get Configure, members get request access).
const POSTHOG_GITHUB_APP_URL = "https://github.com/apps/posthog";

export function githubInstallationSettingsUrl(
  integration: GithubInstallationLike,
): string {
  const accountType = integration.account?.type;
  if (
    typeof accountType === "string" &&
    accountType.toLowerCase() === "organization"
  ) {
    return POSTHOG_GITHUB_APP_URL;
  }
  return `https://github.com/settings/installations/${integration.installation_id}`;
}
