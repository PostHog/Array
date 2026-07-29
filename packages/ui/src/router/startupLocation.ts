import type { PostHogAPIClient } from "@posthog/api-client/posthog-client";
import { ensurePersonalChannel } from "@posthog/ui/features/canvas/ensurePersonalChannel";
import type { Channel } from "@posthog/ui/features/canvas/hooks/useChannels";
import { rendererStateStorage } from "@posthog/ui/shell/rendererStorage";

type ChannelClient = Pick<
  PostHogAPIClient,
  "createDesktopFileSystemChannel" | "getDesktopFileSystemChannels"
>;
type RestoreClient = Pick<
  PostHogAPIClient,
  "getDesktopFileSystemChannels" | "getTask"
>;
type StartupClient = ChannelClient & RestoreClient;

const storageKey = (identity: string): string => `startup-location:${identity}`;
const channelFromPath = ({
  id,
  path,
}: {
  id: string;
  path: string;
}): Channel => ({ id, name: path.replace(/^\/+/, ""), path });

export async function resolveStartupLocation(
  identity: string,
  client: StartupClient,
): Promise<string> {
  const saved = await rendererStateStorage.getItem(storageKey(identity));
  if (
    saved &&
    isRestorableLocation(saved) &&
    (await canRestoreLocation(client, saved))
  ) {
    return saved;
  }
  return await personalNewTaskLocation(client);
}

export function rememberStartupLocation(identity: string, href: string): void {
  if (!isRestorableLocation(href)) return;
  void rendererStateStorage.setItem(storageKey(identity), href);
}

export function isRestorableLocation(href: string): boolean {
  return (
    href.startsWith("/") &&
    href !== "/" &&
    href !== "/code" &&
    href !== "/code/" &&
    href !== "/website/new" &&
    !href.startsWith("/code/tasks/pending/")
  );
}

export async function canRestoreLocation(
  client: RestoreClient,
  href: string,
): Promise<boolean> {
  const taskId = href.match(/^\/code\/tasks\/([^/?#]+)/)?.[1];
  if (taskId) {
    try {
      await client.getTask(decodeURIComponent(taskId));
      return true;
    } catch {
      return false;
    }
  }

  const channelId = href.match(/^\/website\/([^/?#]+)/)?.[1];
  if (channelId && channelId !== "new") {
    try {
      return (await client.getDesktopFileSystemChannels()).some(
        (channel) => channel.id === decodeURIComponent(channelId),
      );
    } catch {
      return false;
    }
  }
  return true;
}

export async function personalNewTaskLocation(
  client: ChannelClient,
): Promise<string> {
  const channels = (await client.getDesktopFileSystemChannels())
    .filter((channel) => channel.type === "folder")
    .map(channelFromPath);
  const personal = await ensurePersonalChannel(channels, async (name) =>
    channelFromPath(await client.createDesktopFileSystemChannel(name)),
  );
  return `/website/${personal.id}/new`;
}
