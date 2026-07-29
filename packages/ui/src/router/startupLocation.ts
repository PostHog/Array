import type { PostHogAPIClient } from "@posthog/api-client/posthog-client";
import { ensurePersonalChannel } from "@posthog/ui/features/canvas/ensurePersonalChannel";
import { toChannel } from "@posthog/ui/features/canvas/hooks/useChannels";
import { rendererStateStorage } from "@posthog/ui/shell/rendererStorage";

type ChannelClient = Pick<
  PostHogAPIClient,
  "createDesktopFileSystemChannel" | "getDesktopFileSystemChannels"
>;
const storageKey = (identity: string): string => `startup-location:${identity}`;

export async function resolveStartupLocation(
  identity: string,
  client: ChannelClient,
): Promise<string> {
  const saved = await rendererStateStorage.getItem(storageKey(identity));
  return saved ?? (await personalNewTaskLocation(client));
}

export function rememberStartupLocation(identity: string, href: string): void {
  void rendererStateStorage.setItem(storageKey(identity), href);
}

export async function personalNewTaskLocation(
  client: ChannelClient,
): Promise<string> {
  const channels = (await client.getDesktopFileSystemChannels())
    .filter((channel) => channel.type === "folder")
    .map(toChannel);
  const personal = await ensurePersonalChannel(channels, async (name) =>
    toChannel(await client.createDesktopFileSystemChannel(name)),
  );
  return `/website/${personal.id}/new`;
}
