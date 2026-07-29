import {
  ensurePersonalChannelFromClient,
  type PersonalChannelClient,
} from "@posthog/ui/features/canvas/ensurePersonalChannel";
import { rendererStateStorage } from "@posthog/ui/shell/rendererStorage";

const storageKey = (identity: string): string => `startup-location:${identity}`;

export async function resolveStartupLocation(
  identity: string,
  client: PersonalChannelClient,
): Promise<string> {
  const saved = await rendererStateStorage.getItem(storageKey(identity));
  if (saved) return saved;
  const personal = await ensurePersonalChannelFromClient(client);
  return `/website/${personal.id}/new`;
}

export function rememberStartupLocation(identity: string, href: string): void {
  void rendererStateStorage.setItem(storageKey(identity), href);
}
