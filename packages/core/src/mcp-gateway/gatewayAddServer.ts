import type {
  McpAuthType,
  McpGatewayInstallSharingOptions,
} from "@posthog/api-client/posthog-client";
import { isValidMcpUrl } from "../mcp-servers/customServerForm";

export type GatewayCredentialMode = "individual" | "shared";

export interface GatewayAddServerValues {
  name: string;
  url: string;
  description: string;
  authType: McpAuthType;
  apiKey: string;
  clientId: string;
  clientSecret: string;
  /** Admin-only sharing options; ignored for non-admin members. */
  teamEnabled: boolean;
  credentialMode: GatewayCredentialMode;
  allowPersonal: boolean;
  agentIds: string[];
}

export const GATEWAY_ADD_SERVER_DEFAULTS: GatewayAddServerValues = {
  name: "",
  url: "",
  description: "",
  authType: "oauth",
  apiKey: "",
  clientId: "",
  clientSecret: "",
  teamEnabled: true,
  credentialMode: "individual",
  allowPersonal: true,
  agentIds: [],
};

export function canSubmitGatewayServer(
  values: Pick<GatewayAddServerValues, "name" | "url">,
): boolean {
  return values.name.trim() !== "" && isValidMcpUrl(values.url);
}

/** API-key servers always run through one shared key held by the gateway. */
export function effectiveCredentialMode(
  values: Pick<GatewayAddServerValues, "authType" | "credentialMode">,
): GatewayCredentialMode {
  return values.authType === "api_key" ? "shared" : values.credentialMode;
}

export interface GatewayInstallRequest extends McpGatewayInstallSharingOptions {
  name: string;
  url: string;
  description: string;
  auth_type: McpAuthType;
  api_key?: string;
  client_id?: string;
  client_secret?: string;
}

/**
 * install_custom payload for registering a server with the gateway. Sharing
 * options are attached only for admins — the backend rejects non-default
 * values from members.
 */
export function buildGatewayInstallRequest(
  values: GatewayAddServerValues,
  options: { isAdmin: boolean },
): GatewayInstallRequest {
  const credentialMode = effectiveCredentialMode(values);
  return {
    name: values.name.trim(),
    url: values.url.trim(),
    description: values.description.trim(),
    auth_type: values.authType,
    ...(values.authType === "api_key" && values.apiKey
      ? { api_key: values.apiKey }
      : {}),
    ...(values.authType === "oauth" && values.clientId.trim()
      ? { client_id: values.clientId.trim() }
      : {}),
    ...(values.authType === "oauth" && values.clientSecret.trim()
      ? { client_secret: values.clientSecret.trim() }
      : {}),
    ...(options.isAdmin
      ? {
          scope: credentialMode === "shared" ? "shared" : "personal",
          team_enabled: values.teamEnabled,
          ...(credentialMode === "shared"
            ? { allow_personal: values.allowPersonal }
            : {}),
          ...(values.agentIds.length ? { agent_ids: values.agentIds } : {}),
        }
      : {}),
  };
}
