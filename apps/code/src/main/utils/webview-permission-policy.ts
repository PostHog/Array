const ALLOWED_WEBVIEW_PERMISSIONS: ReadonlySet<string> = new Set();

export function isAllowedWebviewPermission(permission: string): boolean {
  return ALLOWED_WEBVIEW_PERMISSIONS.has(permission);
}
