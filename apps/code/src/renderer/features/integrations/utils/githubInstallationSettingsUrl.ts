import type { Integration } from "../stores/integrationStore";

interface GithubInstallationAccount {
  type?: string | null;
  name?: string | null;
}

export function githubInstallationSettingsUrl(
  installationId: string,
  account?: GithubInstallationAccount | null,
): string {
  const accountType = account?.type;
  const accountName = account?.name;
  if (
    typeof accountType === "string" &&
    accountType.toLowerCase() === "organization" &&
    typeof accountName === "string" &&
    accountName
  ) {
    return `https://github.com/organizations/${accountName}/settings/installations/${installationId}`;
  }
  return `https://github.com/settings/installations/${installationId}`;
}

/** Resolves a GitHub App installation id from team or user integration payloads. */
export function resolveGithubInstallationId(
  integration: Integration,
): string | null {
  const legacy = integration as {
    installation_id?: string | null;
    integration_id?: string | number | null;
  };
  const candidates = [
    legacy.installation_id,
    legacy.integration_id,
    integration.config?.installation_id,
  ];
  for (const value of candidates) {
    if (value === null || value === undefined) continue;
    const id = String(value).trim();
    if (id) return id;
  }
  return null;
}
