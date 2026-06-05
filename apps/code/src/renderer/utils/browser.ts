import { isSafeExternalUrl } from "@posthog/shared";
import { trpcClient } from "@renderer/trpc/client";

export async function openUrlInBrowser(url: string): Promise<void> {
  if (!isSafeExternalUrl(url)) return;
  try {
    await trpcClient.os.openExternal.mutate({ url });
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
