import type {
  McpRecommendedServer,
  McpServerInstallation,
} from "@posthog/api-client/types";

export function resolveServerName(
  installation: McpServerInstallation,
  template: McpRecommendedServer | null,
): string {
  return (
    installation.display_name ||
    installation.name ||
    template?.name ||
    installation.url ||
    "Server"
  );
}

export interface ResolvedServerDetails {
  name: string;
  description: string;
  docsUrl: string | null;
  iconKey: string | null;
  authType: McpRecommendedServer["auth_type"] | undefined;
}

export function resolveServerDetails(
  installation: McpServerInstallation | null,
  template: McpRecommendedServer | null,
): ResolvedServerDetails {
  return {
    name:
      installation?.display_name ||
      installation?.name ||
      template?.name ||
      installation?.url ||
      "Server",
    description: installation?.description || template?.description || "",
    docsUrl: template?.docs_url || null,
    iconKey: installation?.icon_key || template?.icon_key || null,
    authType: installation?.auth_type || template?.auth_type,
  };
}

export function sortInstallationsByName(
  installations: McpServerInstallation[],
  templatesById: Map<string, McpRecommendedServer>,
): McpServerInstallation[] {
  const nameOf = (installation: McpServerInstallation) =>
    resolveServerName(
      installation,
      installation.template_id
        ? (templatesById.get(installation.template_id) ?? null)
        : null,
    );
  return [...installations].sort((a, b) =>
    nameOf(a).localeCompare(nameOf(b), undefined, { sensitivity: "base" }),
  );
}
