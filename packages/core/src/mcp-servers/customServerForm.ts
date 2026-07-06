import type { McpAuthType } from "@posthog/api-client/types";

export interface CustomServerFormValues {
  name: string;
  url: string;
  description: string;
  authType: McpAuthType;
  apiKey: string;
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
}

export interface CustomServerRequest {
  name: string;
  url: string;
  description: string;
  auth_type: McpAuthType;
  api_key?: string;
  client_id?: string;
  client_secret?: string;
  username?: string;
  password?: string;
}

export function isValidMcpUrl(url: string): boolean {
  return /^https?:\/\/.+/i.test(url.trim());
}

export function canSubmitCustomServer(
  values: Pick<CustomServerFormValues, "name" | "url"> &
    Partial<Pick<CustomServerFormValues, "authType" | "username" | "password">>,
): boolean {
  if (values.name.trim() === "" || !isValidMcpUrl(values.url)) return false;
  if (values.authType === "basic") {
    const hasUsername = Boolean(values.username?.trim());
    const hasPassword = Boolean(values.password);
    if (hasUsername !== hasPassword) return false;
  }
  return true;
}

export function buildCustomServerRequest(
  values: CustomServerFormValues,
): CustomServerRequest {
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
    ...(values.authType === "basic" && values.username.trim() && values.password
      ? { username: values.username.trim(), password: values.password }
      : {}),
  };
}
