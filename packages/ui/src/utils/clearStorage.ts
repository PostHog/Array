import { resolveService } from "@posthog/di/container";
import {
  HOST_TRPC_CLIENT,
  type HostTrpcClient,
} from "@posthog/host-router/client";
import { logger } from "@posthog/ui/shell/logger";

const log = logger.scope("clear-storage");

export function clearApplicationStorage(): void {
  const confirmed = window.confirm(
    "Are you sure you want to clear all application storage?\n\nThis will remove:\n• All registered folders\n• UI state (sidebar preferences, etc.)\n• Task directory mappings\n\nYour files will not be deleted from your computer.",
  );

  if (!confirmed) return;

  resolveService<HostTrpcClient>(HOST_TRPC_CLIENT)
    .folders.clearAllData.mutate()
    .then(() => {
      localStorage.clear();
      window.location.reload();
    })
    .catch((error: unknown) => {
      log.error("Failed to clear storage:", error);
      alert("Failed to clear storage. Please try again.");
    });
}
