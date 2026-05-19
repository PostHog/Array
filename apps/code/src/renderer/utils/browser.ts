import { trpcClient } from "@renderer/trpc/client";

export async function openUrlInBrowser(url: string): Promise<void> {
  try {
    await trpcClient.os.openExternal.mutate({ url });
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
