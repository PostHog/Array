import type { McpServerInstallation } from "@renderer/api/posthogClient";

export type InstallationStatus = "connected" | "pending_oauth" | "needs_reauth";

export function getInstallationStatus(
  installation: McpServerInstallation,
): InstallationStatus {
  if (installation.pending_oauth) return "pending_oauth";
  if (installation.needs_reauth) return "needs_reauth";
  return "connected";
}

export const STATUS_LABELS: Record<InstallationStatus, string> = {
  connected: "Connected",
  pending_oauth: "Finish connecting",
  needs_reauth: "Reconnect required",
};

export const STATUS_COLORS: Record<
  InstallationStatus,
  "green" | "amber" | "red"
> = {
  connected: "green",
  pending_oauth: "amber",
  needs_reauth: "red",
};
