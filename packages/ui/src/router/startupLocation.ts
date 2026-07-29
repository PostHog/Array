import type { PostHogAPIClient } from "@posthog/api-client/posthog-client";
import { ensurePersonalChannel } from "@posthog/ui/features/canvas/ensurePersonalChannel";
import type { Channel } from "@posthog/ui/features/canvas/hooks/useChannels";
import {
  readRendererState,
  writeRendererState,
} from "@posthog/ui/shell/rendererStorage";

const KEY_PREFIX = "startup-location:";

function key(identity: string): string {
  return `${KEY_PREFIX}${identity}`;
}

export async function readStartupLocation(
  identity: string,
): Promise<string | null> {
  return await readRendererState(key(identity));
}

export async function writeStartupLocation(
  identity: string,
  href: string,
): Promise<void> {
  await writeRendererState(key(identity), href);
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
  client: PostHogAPIClient,
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
  client: PostHogAPIClient,
): Promise<string> {
  const toChannel = (channel: { id: string; path: string }): Channel => ({
    id: channel.id,
    name: channel.path.replace(/^\/+/, ""),
    path: channel.path,
  });
  const channels = (await client.getDesktopFileSystemChannels())
    .filter((channel) => channel.type === "folder")
    .map(toChannel);
  const personal = await ensurePersonalChannel(channels, async (name) =>
    toChannel(await client.createDesktopFileSystemChannel(name)),
  );
  return `/website/${personal.id}/new`;
}
